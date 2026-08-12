/**
 * Ultimate Tic-Tac-Toe - pure game module (platform hook contract).
 *
 * A 3x3 grid of tic-tac-toe boards. Winning an inner board claims that cell on
 * the outer board; the cell you play in dictates which inner board your
 * opponent must play next (or, if that board is already decided, they're free
 * to play anywhere).
 *
 * Design and rules ported from https://github.com/mschleeweiss/mttt by
 * mschleeweiss (Marc) - used with his permission. His version is a full
 * NestJS + Socket.io + Vue app; this is a from-scratch reimplementation of the
 * board/win-condition/team-turn/blitz-timer rules in this platform's
 * pure-function style, sharing no code with the original. Thanks, Marc!
 *
 * Pure logic - no CAP imports (so unit tests stay CAP-free). The CAP-touching
 * pre-start actions + blitz timer live in ./extend.js; ./cds-plugin.js composes
 * the two and registers the game with the platform.
 *
 * Board layout: 81 flat cells, index = outerBoard*9 + innerCell (both 0-8,
 * row-major 3x3). `boardWinners[outerBoard]` is 'X'|'O'|'draw'|null.
 *
 * The shared helpers (currentTurn/resolveBlitz + blitz bounds) are named-
 * exported so ./extend.js can reuse them without duplicating logic.
 */

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

export const MIN_BLITZ_SECONDS = 5;
export const MAX_BLITZ_SECONDS = 120;
export const DEFAULT_BLITZ_SECONDS = 30;

const isMark = v => v === 'X' || v === 'O';

// `cells` is either 9 raw marks, or (for the outer board) 9 inner-board
// winners - which can include 'draw'. A 'draw' never counts toward a line:
// three drawn boards in a row must NOT end the game early.
function checkWinner(cells) {
  const line = WIN_LINES.find(
    l => isMark(cells[l[0]]) && cells[l[0]] === cells[l[1]] && cells[l[1]] === cells[l[2]]
  );
  return line ? cells[line[0]] : null;
}

// Whose turn: team alternates every move (regardless of team size), and
// within a team, turns cycle through its members by move count - ported
// directly from the original's determineCurrentPlayer().
export function currentTurn(teams, moveCount) {
  const mark = moveCount % 2 === 0 ? 'X' : 'O';
  const team = teams[mark];
  if (!team.length) return null;
  const idx = Math.floor(moveCount / 2) % team.length;
  return team[idx];
}

function markOf(teams, user) {
  if (teams.X.includes(user)) return 'X';
  if (teams.O.includes(user)) return 'O';
  return null;
}

export function resolveBlitz(settings) {
  const raw = settings.blitz ?? {};
  return {
    enabled: !!raw.enabled,
    seconds: Number.isInteger(raw.seconds)
      ? Math.min(MAX_BLITZ_SECONDS, Math.max(MIN_BLITZ_SECONDS, raw.seconds))
      : DEFAULT_BLITZ_SECONDS,
  };
}

export default {

  meta: {
    name:       'Ultimate Tic-Tac-Toe',
    minPlayers: 2,
    maxPlayers: 8,
    // Server-driven per-move blitz: the platform calls onTick every second
    // while a match is playing (see srv/play-service.js). Only bites when the
    // room enabled blitz; otherwise onTick is a no-op.
    tick: { everyMs: 1000 },
    help: 'A 3x3 grid of tic-tac-toe boards, for 2-8 players split into two teams (X and O). Winning a small board claims that cell on the big outer board. The cell you play dictates which board your opponent plays next, unless that board is already decided, then they are free to choose any open board. Win three boards in a row, column, or diagonal on the outer grid to win the match. An optional blitz timer skips a turn if a team is too slow.',
    gallery: ['gallery/cover-1.svg', 'gallery/cover-2.svg'],
  },

  // Game-declared achievements - SINGLE-MATCH, pure (see checkAchievements).
  achievements: {
    speedDemon: { name: 'Speed Demon', desc: 'Win a match in under 20 moves' },
    boardSweep: { name: 'Board Sweep', desc: "Win without your opponents winning a single board" },
  },

  // Return the ids THIS user earned in THIS finished match. Pure & synchronous;
  // reads only the final state + end, never any history.
  checkAchievements(end, state, user) {
    const earned = [];
    if (end.winner === 'draw') return earned;
    if (!state.teams[end.winner]?.includes(user)) return earned;

    if (state.moveCount < 20) earned.push('speedDemon');

    const otherMark = end.winner === 'X' ? 'O' : 'X';
    if (!state.boardWinners.includes(otherMark)) earned.push('boardSweep');

    return earned;
  },

  init(settings = {}, players = []) {
    // Teams come from pre-start `chooseTeam` picks (persisted in room
    // settings - see ./extend.js). Any player who never picked (or a
    // stale/removed pick) is auto-balanced onto the smaller team, so `start`
    // never silently drops a player.
    const teams = {
      X: [...(settings.teams?.X ?? [])],
      O: [...(settings.teams?.O ?? [])],
    };
    for (const { user } of players) {
      if (teams.X.includes(user) || teams.O.includes(user)) continue;
      (teams.X.length <= teams.O.length ? teams.X : teams.O).push(user);
    }
    // Drop anyone who picked a team but isn't an active room member anymore.
    const active = new Set(players.map(p => p.user));
    teams.X = teams.X.filter(u => active.has(u));
    teams.O = teams.O.filter(u => active.has(u));

    return {
      cells:        Array(81).fill(null),
      boardWinners: Array(9).fill(null),
      winner:       null,
      activeBoard:  null,   // null = any open board is playable
      teams,
      moveCount:    0,
      turn:         currentTurn(teams, 0),
      blitz:        resolveBlitz(settings), // { enabled, seconds } - fixed for the whole match
    };
  },

  applyMove(state, move, user) {
    const { cells, boardWinners, teams, moveCount, activeBoard, blitz } = state;
    const { cell } = move;

    if (user !== state.turn)
      return { error: 'not your turn' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 80)
      return { error: 'invalid cell' };

    const board = Math.floor(cell / 9);
    if (activeBoard != null && board !== activeBoard)
      return { error: 'must play in the active board' };
    if (boardWinners[board] != null)
      return { error: 'that board is already decided' };
    if (cells[cell] != null)
      return { error: 'cell taken' };

    const mark = markOf(teams, user);
    const newCells = [...cells];
    newCells[cell] = mark;

    const newBoardWinners = [...boardWinners];
    const boardCells = newCells.slice(board * 9, board * 9 + 9);
    const boardWinMark = checkWinner(boardCells);
    if (boardWinMark) newBoardWinners[board] = boardWinMark;
    else if (boardCells.every(Boolean)) newBoardWinners[board] = 'draw';

    const outerWinMark = checkWinner(newBoardWinners);
    const outerFull = newBoardWinners.every(Boolean);
    const winner = outerWinMark ?? (outerFull ? 'draw' : null);

    const nextBoard = cell % 9;
    const newActiveBoard = newBoardWinners[nextBoard] != null ? null : nextBoard;
    const newMoveCount = moveCount + 1;

    const newState = {
      cells: newCells,
      boardWinners: newBoardWinners,
      winner,
      activeBoard: winner ? activeBoard : newActiveBoard,
      teams,
      moveCount: newMoveCount,
      turn: winner ? state.turn : currentTurn(teams, newMoveCount),
      blitz,
    };

    return {
      state: newState,
      end: winner ? { winner, teams } : null,
    };
  },

  // Server-driven blitz: skip the current player's turn once they've run past
  // the configured per-move limit. Pure - the platform supplies `elapsedMs`
  // (how long this turn has run) so no clock lives in the reducer. Returns null
  // (no change) when blitz is off, the game is over, or time remains. A skip
  // never ends the game, so there's no `end`.
  onTick(state, elapsedMs) {
    if (state.winner || !state.blitz?.enabled) return null;
    if (elapsedMs < state.blitz.seconds * 1000) return null;
    const timedOut = state.turn;
    const moveCount = state.moveCount + 1;
    return {
      state: { ...state, moveCount, turn: currentTurn(state.teams, moveCount) },
      sys: `${timedOut} timed out - turn skipped.`,
    };
  },

  // defaultScore only supports a single winning `user` - a team win needs
  // every teammate scored, so this game supplies its own.
  score(end, players) {
    const { winner, teams } = end;
    return players
      .filter(p => !p.spectator)
      .map(p => {
        const onWinningTeam = winner !== 'draw' && teams[winner]?.includes(p.user);
        return {
          user: p.user,
          result: winner === 'draw' ? 'draw' : (onWinningTeam ? 'win' : 'loss'),
          points: winner === 'draw' ? 1 : (onWinningTeam ? 3 : 0),
        };
      });
  },
};
