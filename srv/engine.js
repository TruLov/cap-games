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
 *   - Transient board state (current move state, per room)
 *   - Scoring dispatch
 *
 * Reconnect grace + disconnect-announce debounce live in presence.js.
 */

import { get as registryGet } from './registry.js';

// Transient board state (non-persistent, lost on restart - intentional)
// roomId → { game, state, turn }
const boardState = {};

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
  defaultScore,
};
