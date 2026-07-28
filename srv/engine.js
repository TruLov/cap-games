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

// Transient board state (non-persistent, lost on restart — intentional)
// roomId → { game, state, turn }
const boardState = {};

// Reconnect grace timers — kept independent of board state so they work in
// ANY room status (lobby/playing/paused/finished), not just while a board
// exists. roomId → Map<userId, timer>
const graceTimers = {};

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

// --- Default scoring (W:3 D:1 L:0) — used if game.score() not provided ---
// end.winner is a `user` id (or 'draw'); scoring keys on user.
function defaultScore(end, players) {
  return players
    .filter(p => !p.spectator)
    .map(p => ({
      user:   p.user,
      result: end.winner === 'draw'  ? 'draw'
            : p.user === end.winner ? 'win' : 'loss',
      points: end.winner === 'draw'  ? 1
            : p.user === end.winner ? 3 : 0,
    }));
}

export {
  guardStatus, guardHost,
  getBoard, deleteBoard, initBoard,
  setGraceTimer, clearGraceTimer, hasGraceTimer, allGraceTimers,
  defaultScore,
};
