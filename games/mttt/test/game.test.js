import { describe, it } from 'node:test';
import cds from '@sap/cds';
import game from '../game.js';

const { expect } = cds.test;

const players = [
  { user: 'alice', isHost: true },
  { user: 'bob' },
  { user: 'carol' },
];

function mkState(overrides = {}) {
  return {
    cells: Array(81).fill(null),
    boardWinners: Array(9).fill(null),
    winner: null,
    activeBoard: null,
    teams: { X: ['alice'], O: ['bob'] },
    moveCount: 0,
    turn: 'alice',
    blitz: { enabled: false, seconds: 30 },
    ...overrides,
  };
}

describe('ultimate tic-tac-toe', () => {

  it('interface + init contract', () => {
    expect(game.meta.minPlayers).to.equal(2);
    expect(game.meta.maxPlayers).to.be.at.least(2);
  });

  it('init: honors pre-picked teams from settings', () => {
    const s = game.init({ teams: { X: ['alice'], O: ['bob', 'carol'] } }, players);
    expect(s.teams).to.deep.equal({ X: ['alice'], O: ['bob', 'carol'] });
    expect(s.turn).to.equal('alice');   // X, index 0
    expect(s.cells).to.have.length(81);
    expect(s.boardWinners).to.have.length(9);
  });

  it('init: auto-balances any player who never picked a team', () => {
    const s = game.init({ teams: { X: ['alice'], O: [] } }, players);
    // bob and carol never picked - balanced by size (ties favor X): bob to
    // O (smaller), then carol to X (tied at 1-1).
    expect(s.teams.X).to.deep.equal(['alice', 'carol']);
    expect(s.teams.O).to.deep.equal(['bob']);
  });

  it('init: drops picks for players no longer in the room', () => {
    const s = game.init({ teams: { X: ['alice', 'dave'], O: ['bob'] } }, players);
    expect(s.teams.X).to.deep.equal(['alice']);
  });

  it('init: blitz defaults to disabled with a 30s default', () => {
    const s = game.init({}, players);
    expect(s.blitz).to.deep.equal({ enabled: false, seconds: 30 });
  });

  it('init: honors an enabled blitz setting from configureBlitz', () => {
    const s = game.init({ blitz: { enabled: true, seconds: 15 } }, players);
    expect(s.blitz).to.deep.equal({ enabled: true, seconds: 15 });
  });

  it('init: clamps an out-of-range blitz seconds value', () => {
    // configureBlitz validates bounds server-side before this is ever
    // persisted, but init() stays defensive against corrupted/old settings.
    const tooHigh = game.init({ blitz: { enabled: true, seconds: 9999 } }, players);
    expect(tooHigh.blitz.seconds).to.equal(120);
    const tooLow = game.init({ blitz: { enabled: true, seconds: 1 } }, players);
    expect(tooLow.blitz.seconds).to.equal(5);
  });

  it('applyMove carries blitz settings through unchanged', () => {
    const s = mkState({ blitz: { enabled: true, seconds: 15 } });
    const r = game.applyMove(s, { cell: 0 }, 'alice');
    expect(r.state.blitz).to.deep.equal({ enabled: true, seconds: 15 });
  });

  // --- server-driven blitz (onTick, a pure reducer - no timers/WS) ---------
  it('meta declares a server tick', () => {
    expect(game.meta.tick).to.deep.equal({ everyMs: 1000 });
  });

  it('onTick: no-op while blitz is disabled', () => {
    const s = mkState({ blitz: { enabled: false, seconds: 10 } });
    expect(game.onTick(s, 999_999)).to.equal(null);
  });

  it('onTick: no-op while time remains', () => {
    const s = mkState({ blitz: { enabled: true, seconds: 10 } });
    expect(game.onTick(s, 9_000)).to.equal(null);   // 9s < 10s
  });

  it('onTick: skips the current turn once past the limit', () => {
    const s = mkState({ blitz: { enabled: true, seconds: 10 }, turn: 'alice', moveCount: 0 });
    const r = game.onTick(s, 10_000);               // exactly at the limit
    expect(r.state.turn).to.equal('bob');           // O team, move 1
    expect(r.state.moveCount).to.equal(1);
    expect(r.state.cells).to.deep.equal(s.cells);   // board untouched - only a skip
    expect(r.end).to.equal(undefined);              // a skip never ends the game
    expect(r.sys).to.match(/alice.*timed out/i);
  });

  it('onTick: no-op once the game is already won', () => {
    const s = mkState({ blitz: { enabled: true, seconds: 10 }, winner: 'X' });
    expect(game.onTick(s, 999_999)).to.equal(null);
  });

  it('applyMove rejects illegal moves', () => {
    const s = mkState();
    expect(game.applyMove(s, { cell: 0 }, 'bob').error).to.equal('not your turn');
    expect(game.applyMove(s, { cell: 81 }, 'alice').error).to.be.ok;
    expect(game.applyMove(s, { cell: -1 }, 'alice').error).to.be.ok;

    const s2 = mkState({ activeBoard: 3 });
    expect(game.applyMove(s2, { cell: 0 }, 'alice').error).to.equal('must play in the active board');

    const s3 = mkState({ cells: [...Array(81).fill(null)].map((_, i) => i === 5 ? 'O' : null) });
    expect(game.applyMove(s3, { cell: 5 }, 'alice').error).to.equal('cell taken');

    const s4 = mkState({ boardWinners: [ 'X', null, null, null, null, null, null, null, null ] });
    expect(game.applyMove(s4, { cell: 0 }, 'alice').error).to.equal('that board is already decided');
  });

  it('winning an inner board forces the next board on the opponent', () => {
    // board 0: alice (X) has cells 0,1 filled; playing cell 2 completes the top row.
    const cells = Array(81).fill(null);
    cells[0] = 'X'; cells[1] = 'X';
    cells[3] = 'O'; cells[4] = 'O'; // bob's moves elsewhere in board 0, irrelevant to the row
    const s = mkState({ cells, activeBoard: 0, turn: 'alice', moveCount: 4 });

    const r = game.applyMove(s, { cell: 2 }, 'alice');
    expect(r.state.boardWinners[0]).to.equal('X');
    // cell 2 -> nextBoard = 2 % 9 = 2, which is undecided -> opponent forced there
    expect(r.state.activeBoard).to.equal(2);
    expect(r.state.turn).to.equal('bob');
    expect(r.end).to.equal(null); // inner win only, game not over
  });

  it('free choice once the forced target board is already decided', () => {
    const cells = Array(81).fill(null);
    cells[0] = 'X'; cells[1] = 'X';
    const boardWinners = Array(9).fill(null);
    boardWinners[2] = 'draw'; // the board cell 2 would normally force is already decided
    const s = mkState({ cells, boardWinners, activeBoard: 0, turn: 'alice', moveCount: 4 });

    const r = game.applyMove(s, { cell: 2 }, 'alice');
    expect(r.state.activeBoard).to.equal(null); // free choice, board 2 already settled
  });

  it('winning the outer board ends the game with the team roster attached', () => {
    const boardWinners = ['X', 'X', null, null, null, null, null, null, null];
    const cells = Array(81).fill(null);
    cells[18] = 'X'; cells[19] = 'X'; // board 2, two of a row - cell 20 completes it
    const s = mkState({
      cells, boardWinners, activeBoard: 2, turn: 'alice', moveCount: 4,
      teams: { X: ['alice', 'dave'], O: ['bob'] },
    });

    const r = game.applyMove(s, { cell: 20 }, 'alice');
    expect(r.state.boardWinners[2]).to.equal('X');
    expect(r.state.winner).to.equal('X');   // top row of the outer board: boards 0,1,2
    expect(r.end).to.deep.equal({ winner: 'X', teams: { X: ['alice', 'dave'], O: ['bob'] } });
  });

  it('a full board with no line is a draw at both levels', () => {
    // fill inner board 0 with an alternating pattern that has no line
    const cells = Array(81).fill(null);
    const pattern = ['X','O','X','X','O','O','O','X'];
    pattern.forEach((m, i) => cells[i] = m);
    const boardWinners = Array(9).fill('draw'); // pretend every other board is already drawn
    boardWinners[0] = null;
    const s = mkState({ cells, boardWinners, activeBoard: 0, turn: 'alice', moveCount: 4 });

    const r = game.applyMove(s, { cell: 8 }, 'alice'); // last cell, completes the fill, no line
    expect(r.state.boardWinners[0]).to.equal('draw');
    expect(r.state.winner).to.equal('draw'); // all 9 board winners now set, no outer line
    expect(r.end).to.deep.equal({ winner: 'draw', teams: s.teams });
  });

  it('three drawn boards in a line do NOT end the game early', () => {
    // boards 0 and 1 (outer top row) are already drawn; this move fills
    // board 2 with a no-line pattern, drawing it too - completing a "line"
    // of three draws in the outer row. Boards 3-8 are still open, so the
    // game must NOT end: a draw never counts toward an outer-board line.
    const boardWinners = ['draw', 'draw', null, null, null, null, null, null, null];
    const cells = Array(81).fill(null);
    const noLinePattern = ['X','O','X','X','O','O','O','X']; // relative indices 0-7 of board 2
    noLinePattern.forEach((m, i) => { cells[18 + i] = m; });
    const s = mkState({ cells, boardWinners, activeBoard: 2, turn: 'alice', moveCount: 4 });

    const r = game.applyMove(s, { cell: 26 }, 'alice'); // last cell of board 2 (relative index 8)
    expect(r.state.boardWinners[2]).to.equal('draw');
    expect(r.state.boardWinners.slice(0, 3)).to.deep.equal(['draw', 'draw', 'draw']);
    expect(r.state.winner).to.equal(null); // a line of draws is not a win - game continues
    expect(r.end).to.equal(null);
  });

  it('init: X moves first (move count 0 -> team X, member index 0)', () => {
    const s = game.init({ teams: { X: ['alice', 'dave'], O: ['bob'] } }, players);
    expect(s.turn).to.equal('alice');
  });

  it('team turn rotation cycles within an uneven team by move count', () => {
    // X: [alice, dave] (2 members), O: [bob] (1 member). Team alternates every
    // move regardless of size; within a team, turns cycle by member index.
    // Each iteration constructs a fresh state at a given moveCount (playing a
    // distinct, always-free-choice board) purely to observe the resulting
    // `state.turn` - isolated from the active-board forcing rule, which is
    // covered by its own tests above.
    const teams = { X: ['alice', 'dave'], O: ['bob'] };
    const expectedTurnAfter = ['bob', 'dave', 'bob', 'alice']; // after moveCount 0,1,2,3 respectively
    for (let mc = 0; mc < 4; mc++) {
      const s = mkState({ teams, moveCount: mc, activeBoard: null, turn: 'whoever' });
      const r = game.applyMove(s, { cell: mc * 9 }, 'whoever');
      expect(r.state.turn).to.equal(expectedTurnAfter[mc]);
    }
  });

  it('score: every teammate on the winning team gets a win, the other team a loss', () => {
    const end = { winner: 'X', teams: { X: ['alice', 'dave'], O: ['bob'] } };
    const scores = game.score(end, [
      { user: 'alice', spectator: false }, { user: 'dave', spectator: false },
      { user: 'bob', spectator: false }, { user: 'eve', spectator: true },
    ]);
    const byUser = Object.fromEntries(scores.map(s => [s.user, s]));
    expect(byUser.alice.result).to.equal('win');
    expect(byUser.dave.result).to.equal('win');
    expect(byUser.bob.result).to.equal('loss');
    expect(byUser.eve).to.equal(undefined); // spectators excluded
  });

  it('score: a draw gives everyone a draw result', () => {
    const end = { winner: 'draw', teams: { X: ['alice'], O: ['bob'] } };
    const scores = game.score(end, [{ user: 'alice', spectator: false }, { user: 'bob', spectator: false }]);
    expect(scores.every(s => s.result === 'draw')).to.equal(true);
  });

});
