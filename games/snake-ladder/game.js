/**
 * Snake & Ladder - pure game module (platform hook contract).
 *
 * Implements meta, init, applyMove - pure logic, no CAP imports (so it stays
 * unit-testable without a DB). Ported from the standalone CAP tutorial app: the
 * dice/exact-100/snake/ladder rules that used to live in an OData service +
 * @flow state machine are now a single reducer the platform drives over its WS
 * PlayService, exactly like the other games.
 *
 * Adapted from the SAP CAP "July Developer Challenge - Snake & Ladder with
 * status transition" tutorial by ajay_soreng:
 * https://community.sap.com/t5/sap-cap-blog-posts/july-developer-challenge-snake-amp-ladder-with-sap-cap-status-transition/ba-p/14429486
 * The tutorial models the game as an OData service with a @flow.status state
 * machine; this is a from-scratch reimplementation of the same board/dice rules
 * as a pure reducer for this platform's WS contract.
 *
 * The board (snakes/ladders) is NOT hardcoded here - it's this plugin's own
 * `snakeladder.BoardSquares` table, loaded once by ./extend.js and pushed in via
 * setBoard() before any match starts. Keeping the table as the single source of
 * truth is the whole point of shipping game-owned persistence (see ./schema.cds).
 *
 * State shape:
 *   positions  { [user]: square 1..100 }
 *   blocked    { [user]: bool }   double-head snake → skip your next turn
 *   order      [user, ...]        fixed turn order (host first)
 *   turn       user               whose turn it is
 *   winner     user | null
 *   turnNumber int                monotonic, for TurnLog dedupe
 *   lastMove   { user, roll, from, to, event } | null   last resolved move
 */

// Board jump map, populated from the DB table by ./extend.js:
//   { [square]: { to, doubleHead } }
let BOARD = null;

export function setBoard(rows = []) {
  const map = {};
  for (const r of rows) {
    if (r.ladderTo)     map[r.square] = { to: r.ladderTo, doubleHead: false };
    else if (r.snakeTo) map[r.square] = { to: r.snakeTo, doubleHead: !!r.isDoubleHead };
  }
  BOARD = map;
}

// Advance to the next player who is neither the winner nor blocked; a blocked
// player is skipped exactly once (their block is consumed here, mutating the
// caller's fresh copy). Loop-guarded in case everyone is blocked at once.
function nextTurn(order, turn, blocked, winner) {
  let idx = order.indexOf(turn);
  for (let guard = 0; guard <= order.length; guard++) {
    idx = (idx + 1) % order.length;
    const u = order[idx];
    if (u === winner) continue;
    if (blocked[u]) { blocked[u] = false; continue; }
    return u;
  }
  return order[(order.indexOf(turn) + 1) % order.length];
}

export default {

  meta: {
    name:       'Snake & Ladder',
    minPlayers: 2,
    maxPlayers: 4,
    help: 'The classic board race for 2-4 players. Roll the dice and move your token along the 100-square board. Land on a ladder to climb up, or a snake to slide back down - some snakes have a double head that also skips your next turn. You must land exactly on square 100 to win; overshooting forfeits your move.',
    gallery: ['gallery/cover-1.svg', 'gallery/cover-2.svg', 'board.png'],
  },

  // Game-declared achievements - SINGLE-MATCH, pure (see checkAchievements).
  achievements: {
    bullseye: { name: 'Bullseye', desc: 'Win with the exact roll needed - no ladder or snake assist' },
  },

  checkAchievements(_end, state, user) {
    const earned = [];
    const m = state.lastMove;
    if (m && m.user === user && state.winner === user && m.from + m.roll === 100) earned.push('bullseye');
    return earned;
  },

  init(_settings = {}, players = []) {
    const order = players.map(p => p.user);
    const positions = {}, blocked = {};
    for (const u of order) { positions[u] = 1; blocked[u] = false; }
    return {
      positions, blocked, order,
      turn: order[0] ?? null,
      winner: null,
      turnNumber: 0,
      lastMove: null,
    };
  },

  // The only move is a dice roll: move = { type: 'roll' } (payload ignored).
  // Runs server-side in engine.js, so Math.random() here is authoritative - the
  // client never rolls.
  applyMove(state, _move, user) {
    if (!BOARD) return { error: 'board not loaded' };
    if (state.winner) return { error: 'game over' };
    if (user !== state.turn) return { error: 'not your turn' };

    const positions = { ...state.positions };
    const blocked   = { ...state.blocked };
    const from = positions[user];

    const roll   = Math.ceil(Math.random() * 6);
    const target = from + roll;

    let to = from, event = 'normal';
    if (target > 100) {
      event = 'overshoot';          // must land exactly on 100 - no move, turn passes
    } else {
      to = target;
      const jump = BOARD[target];
      if (jump) {
        to = jump.to;
        event = to > target ? 'ladder' : (jump.doubleHead ? 'doubleSnake' : 'snake');
      }
    }

    positions[user] = to;
    if (event === 'doubleSnake') blocked[user] = true;   // skip next turn

    const winner = to === 100 ? user : null;
    const turn = winner ? state.turn : nextTurn(state.order, user, blocked, winner);

    const newState = {
      ...state,
      positions,
      blocked,
      turn,
      winner,
      turnNumber: state.turnNumber + 1,
      lastMove: { user, roll, from, to, event: winner ? 'win' : event },
    };

    return { state: newState, end: winner ? { winner } : null };
  },
};
