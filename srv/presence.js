/**
 * Presence — reconnect grace + disconnect-announce debounce for a dropped
 * player, in ANY room status (lobby/playing/paused/finished), independent of
 * whether a board exists.
 *
 * A dropped socket starts two clocks:
 *   - grace (60s):    if the player hasn't reconnected by then, they're
 *                      treated as having left (onDrop).
 *   - announce (3s):  a page refresh reconnects within a few hundred ms, so
 *                      the "disconnected" broadcast is held back this long -
 *                      collapsing a refresh into a silent no-op. Only a drop
 *                      that outlasts this window is ever announced to the
 *                      rest of the room (onAnnounce).
 *
 * reconnect() is the single place that resolves the debounce: it reports
 * whether the announce fired before the player came back, so the caller
 * knows whether a "reconnected" message is owed to the room (silent refresh
 * → no "disconnected" ever went out → no "reconnected" either).
 */

const GRACE_MS    = 60_000;
const ANNOUNCE_MS = 3_000;

// roomId → Map<userId, timer>
const graceTimers    = {};
const announceTimers = {};

function setTimer(store, roomId, userId, delay, onFire) {
  const timer = setTimeout(() => {
    store[roomId]?.delete(userId);
    if (store[roomId]?.size === 0) delete store[roomId];
    onFire();
  }, delay);
  (store[roomId] ??= new Map()).set(userId, timer);
}

// Returns true if a timer was pending (and is now cancelled); false if none was set.
function clearTimer(store, roomId, userId) {
  const m = store[roomId];
  if (!m || !m.has(userId)) return false;
  clearTimeout(m.get(userId));
  m.delete(userId);
  if (m.size === 0) delete store[roomId];
  return true;
}

/**
 * Start the grace + announce clocks for a dropped player. graceMs/announceMs
 * default to the real windows; callers only ever override them in tests, to
 * exercise the debounce without waiting out the real 60s/3s.
 */
function disconnect(roomId, userId, { onDrop, onAnnounce, graceMs = GRACE_MS, announceMs = ANNOUNCE_MS }) {
  setTimer(graceTimers, roomId, userId, graceMs, onDrop);
  setTimer(announceTimers, roomId, userId, announceMs, onAnnounce);
}

/**
 * The player came back. Cancels both clocks and reports whether the
 * "disconnected" announcement already went out before they returned:
 *   'silent'   - announce timer hadn't fired yet (quick refresh) - the room
 *                was never told, so stay quiet on reconnect too.
 *   'announce' - announce timer had already fired - the room was told, so
 *                the reconnect must be announced as well.
 */
function reconnect(roomId, userId) {
  clearTimer(graceTimers, roomId, userId);
  const stillPending = clearTimer(announceTimers, roomId, userId);
  return stillPending ? 'silent' : 'announce';
}

/** The player is really gone (kicked, left, or grace expired) - cancel both clocks. */
function leave(roomId, userId) {
  clearTimer(graceTimers, roomId, userId);
  clearTimer(announceTimers, roomId, userId);
}

/** Is this join actually a reconnect (a grace clock is running for them)? */
function isPending(roomId, userId) {
  return graceTimers[roomId]?.has(userId) ?? false;
}

/** Every user with a grace clock still running in this room (autodelete guard). */
function pendingUsers(roomId) {
  return [...(graceTimers[roomId]?.keys() ?? [])];
}

export { disconnect, reconnect, leave, isPending, pendingUsers };
