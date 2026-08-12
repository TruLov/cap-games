/**
 * Generic Game Engine
 *
 * Manages transient board state for active rooms.
 * Persistent room/player data lives in DB (via CDS services).
 *
 * Responsibilities:
 *   - Status transition guard
 *   - Host guard
 *   - Host succession
 *   - Reconnect grace timers
 *   - Transient board state (current move state, per room)
 *   - Scoring dispatch
 */

import { get as registryGet } from './registry.js';

const GRACE_MS = 60_000;
// How long to wait before telling the OTHER players that someone dropped. A
// page refresh reconnects within a few hundred ms, so debouncing the
// announcement collapses the refresh into a silent no-op; only a real dropout
// that outlasts this window is broadcast as "disconnected".
const ANNOUNCE_MS = 3_000;

// Transient board state (non-persistent, lost on restart - intentional)
// roomId → { game, state, turn }
const boardState = {};

// Reconnect grace timers - kept independent of board state so they work in
// ANY room status (lobby/playing/paused/finished), not just while a board
// exists. roomId → Map<userId, timer>
const graceTimers = {};

// Disconnect-announce timers - the debounce that hides refresh churn from
// other players (see ANNOUNCE_MS). roomId → Map<userId, timer>
const announceTimers = {};

// --- Status transitions ---
const TRANSITIONS = {
  configure:   { from: ['lobby'] },
  start:       { from: ['lobby'] },
  move:        { from: ['playing'] },
  rematch:     { from: ['finished'] },
  backToRoom:  { from: ['finished', 'playing', 'paused'] },
  switchGame:  { from: ['lobby'] },
  setRole:     { from: ['lobby'] },
};

function guardStatus(status, action) {
  const t = TRANSITIONS[action];
  if (t && !t.from.includes(status))
    return `cannot ${action} when status is ${status}`;
}

function guardHost(room, userId) {
  if (room.host !== userId) return 'only host can do this';
}

// --- Board state accessors ---
function getBoard(roomId)    { return boardState[roomId]; }
function deleteBoard(roomId) { delete boardState[roomId]; }

function initBoard(roomId, game, settings, players = []) {
  const gm = registryGet(game);
  const state = gm.init(settings ? JSON.parse(settings) : {}, players);
  boardState[roomId] = { game, state, turn: state.turn ?? null };
  return boardState[roomId];
}

// --- Reconnect grace ---
function setGraceTimer(roomId, userId, callback) {
  const timer = setTimeout(callback, GRACE_MS);
  (graceTimers[roomId] ??= new Map()).set(userId, timer);
}

function clearGraceTimer(roomId, userId) {
  const m = graceTimers[roomId];
  if (!m) return;
  clearTimeout(m.get(userId));
  m.delete(userId);
  if (m.size === 0) delete graceTimers[roomId];
}

function hasGraceTimer(roomId, userId) {
  return graceTimers[roomId]?.has(userId) ?? false;
}

function allGraceTimers(roomId) {
  return [...(graceTimers[roomId]?.keys() ?? [])];
}

// --- Disconnect-announce debounce ---
// Schedule the "player disconnected" broadcast. The timer removes itself when
// it fires, so clearAnnounceTimer() can tell whether the announcement already
// went out.
function setAnnounceTimer(roomId, userId, callback, delay = ANNOUNCE_MS) {
  const timer = setTimeout(() => {
    announceTimers[roomId]?.delete(userId);
    if (announceTimers[roomId]?.size === 0) delete announceTimers[roomId];
    callback();
  }, delay);
  (announceTimers[roomId] ??= new Map()).set(userId, timer);
}

// Cancel a pending announce. Returns true if it was still pending (i.e. the
// disconnect was NOT yet broadcast - so a reconnect can stay silent); false if
// it had already fired (the room was told, so a reconnect must be announced).
function clearAnnounceTimer(roomId, userId) {
  const m = announceTimers[roomId];
  if (!m || !m.has(userId)) return false;
  clearTimeout(m.get(userId));
  m.delete(userId);
  if (m.size === 0) delete announceTimers[roomId];
  return true;
}

// --- Default scoring - used if game.score() not provided ---
// end.winner is a `user` id (or 'draw'); result keys on user (W/D/L). Points
// default to W:3 D:1 L:0, but a game that carries its own tally can pass
// `pointsOf(user) → number` to attach real points while reusing this W/D/L
// mapping instead of hand-rolling one (see games/flipfortune).
function defaultScore(end, players, { pointsOf } = {}) {
  return players
    .filter(p => !p.spectator)
    .map(p => ({
      user:   p.user,
      result: end.winner === 'draw'  ? 'draw'
            : p.user === end.winner ? 'win' : 'loss',
      points: pointsOf ? pointsOf(p.user)
            : end.winner === 'draw'  ? 1
            : p.user === end.winner ? 3 : 0,
    }));
}

export {
  guardStatus, guardHost,
  getBoard, deleteBoard, initBoard,
  setGraceTimer, clearGraceTimer, hasGraceTimer, allGraceTimers,
  setAnnounceTimer, clearAnnounceTimer,
  defaultScore,
};
