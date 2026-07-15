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

const GRACE_MS = 60_000;

// Transient board state (non-persistent, lost on restart — intentional)
// roomId → { game, state, turn, disconnected: Map<userId, timer> }
const boardState = {};

// --- Status transitions ---
const TRANSITIONS = {
  configure:   { from: ['lobby'] },
  start:       { from: ['lobby'] },
  move:        { from: ['playing'] },
  rematch:     { from: ['finished'] },
  backToLobby: { from: ['finished', 'playing', 'paused'] },
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

function initBoard(roomId, game, settings) {
  const registry = require('./registry');
  const gm = registry.get(game);
  const state = gm.init(settings ? JSON.parse(settings) : {});
  boardState[roomId] = { game, state, turn: state.turn ?? 'X', disconnected: new Map() };
  return boardState[roomId];
}

// --- Reconnect grace ---
function setGraceTimer(roomId, userId, callback) {
  const b = boardState[roomId];
  if (!b) return;
  const timer = setTimeout(callback, GRACE_MS);
  b.disconnected.set(userId, timer);
}

function clearGraceTimer(roomId, userId) {
  const b = boardState[roomId];
  if (!b) return;
  clearTimeout(b.disconnected.get(userId));
  b.disconnected.delete(userId);
}

function hasGraceTimer(roomId, userId) {
  return boardState[roomId]?.disconnected.has(userId) ?? false;
}

function allGraceTimers(roomId) {
  return [...(boardState[roomId]?.disconnected.keys() ?? [])];
}

// --- Default scoring (W:3 D:1 L:0) — used if game.score() not provided ---
function defaultScore(end, players) {
  return players
    .filter(p => p.symbol !== 'spectator')
    .map(p => ({
      user:   p.user,
      result: end.winner === 'draw'    ? 'draw'
            : p.symbol  === end.winner ? 'win' : 'loss',
      points: end.winner === 'draw'    ? 1
            : p.symbol  === end.winner ? 3 : 0,
    }));
}

module.exports = {
  GRACE_MS,
  guardStatus, guardHost,
  getBoard, deleteBoard, initBoard,
  setGraceTimer, clearGraceTimer, hasGraceTimer, allGraceTimers,
  defaultScore,
};
