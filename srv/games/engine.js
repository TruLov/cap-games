/**
 * Generic Game Engine
 *
 * Handles all room infrastructure: host, players, spectators, status transitions,
 * reconnect grace period, auto-delete, host succession, logging.
 *
 * Game modules plug in via the GAMES registry:
 *   { init() → state, applyMove(state, move, symbol) → { state, end? } }
 *
 * A new game = one new file + one registry entry in GAMES.
 */

const cds = require('@sap/cds');
const LOG = cds.log('game');

const GRACE_MS = 60_000; // reconnect grace period

// --- Game module registry ---
// Key = game identifier (sent in join action)
// Value = { minPlayers, maxPlayers, init(), applyMove(state, move, symbol) }
const GAMES = {};

// rooms: { [roomId]: Room }
// Room: { game, host, players:{X,O}, spectators:Set,
//         status:'lobby'|'playing'|'finished'|'paused',
//         firstPlayer:'X'|'O'|'random', state:{},
//         disconnected:Map<userId,timer> }
const rooms = {};

// --- Status transition guard ---
const TRANSITIONS = {
  start:       { from: ['lobby']               },
  move:        { from: ['playing']             },
  rematch:     { from: ['finished']            },
  backToLobby: { from: ['finished', 'playing', 'paused'] },
};

function guardStatus(r, action) {
  const t = TRANSITIONS[action];
  if (t && !t.from.includes(r.status))
    return `cannot ${action} when status is ${r.status}`;
}

function guardHost(r, userId) {
  if (r.host !== userId) return 'only host can do this';
}

// --- Host succession ---
// Order: O → first spectator → null (delete room)
function succeedHost(r, leavingUser) {
  // find next: prefer O if not leaving, else first spectator
  const candidates = [
    r.players.O !== leavingUser ? r.players.O : null,
    ...[...r.spectators].filter(u => u !== leavingUser),
  ].filter(Boolean);
  return candidates[0] ?? null;
}

// --- Remove player from room, handle host succession, auto-delete ---
function removePlayer(r, roomId, userId) {
  const symbol = r.players.X === userId ? 'X' : r.players.O === userId ? 'O' : null;
  if (symbol) {
    delete r.players[symbol];
    // shift remaining player to X slot if X left
    if (symbol === 'X' && r.players.O) {
      r.players.X = r.players.O;
      delete r.players.O;
    }
  } else {
    r.spectators.delete(userId);
  }

  // host succession
  let newHost = r.host;
  if (r.host === userId) {
    newHost = succeedHost(r, userId);
    r.host = newHost;
    // promote new host to X if they were O and X is free
    if (newHost && !r.players.X && r.players.O === newHost) {
      r.players.X = newHost;
      delete r.players.O;
    }
  }

  // auto-delete if empty
  if (!r.players.X && !r.players.O && r.spectators.size === 0 && r.disconnected.size === 0) {
    delete rooms[roomId];
    LOG.info('ROOM', roomId, 'deleted (empty)');
    return { symbol, newHost: null, deleted: true };
  }
  return { symbol, newHost };
}

// --- Reset board state to lobby ---
function resetToLobby(r) {
  r.status = 'lobby';
  r.state = r.game ? GAMES[r.game].init() : {};
}

// --- Reset board and go directly to playing ---
function resetToPlaying(r) {
  r.status = 'playing';
  r.state = GAMES[r.game].init();
  // apply firstPlayer setting
  if (r.firstPlayer === 'random') {
    r.turn = Math.random() < 0.5 ? 'X' : 'O';
  } else {
    r.turn = r.firstPlayer || 'X';
  }
}

// --- Exports ---

module.exports = { GAMES, rooms, guardStatus, guardHost, removePlayer, resetToLobby, resetToPlaying, GRACE_MS };
