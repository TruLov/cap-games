/**
 * room-session.js - the fixed set of resources that live for a room's whole
 * lifetime (from 'joined' to leaveRoom), regardless of which page is showing
 * or whether a match happens to be mounted right now: the roster/lifecycle
 * event subscriptions, plus the persistent players + chat panels (see
 * platform.js - "players + chat live in the persistent room chrome").
 *
 * Anything that toggles WHILE inside a room - waiting-room controls vs. an
 * active match (matchUnmount/waitingUnmount) - is NOT session-scoped; it's a
 * state machine with its own transitions (mountGame()/showWaitingRoom()/
 * onRoomResetTopLevel() in platform.js) and stays there.
 *
 * open(emitter, pairs) subscribes every [event, handler] pair immediately and
 * returns a session handle:
 *   session.defer(fn)  - register an extra cleanup (e.g. a component's own
 *                        unmount) to run when the session closes. Call this
 *                        for anything mounted alongside the subscriptions -
 *                        it keeps "what's alive for the room" in one place
 *                        instead of a second hand-mirrored list.
 *   session.close()    - unsubscribe every pair and run every deferred
 *                        cleanup, in registration order. Idempotent no-op if
 *                        called twice.
 */
export function openRoomSession(emitter, pairs) {
  pairs.forEach(([ev, fn]) => emitter.on(ev, fn));
  const cleanups = [];
  let closed = false;
  return {
    defer(fn) { if (fn) cleanups.push(fn); },
    close() {
      if (closed) return;
      closed = true;
      pairs.forEach(([ev, fn]) => emitter.off(ev, fn));
      cleanups.splice(0).forEach(fn => fn());
    },
  };
}
