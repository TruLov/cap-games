import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FACES, scoreDice } from '../dice.js';
import { applyMove, init, score } from '../flow.js';

// ---- scripted RNG ---------------------------------------------------------
// rollFace maps rng() -> FACES[floor(rng()*6)]. Emit the midpoint of a face's
// slot to roll it deterministically; once the script runs dry, return 0 (a
// harmless default — the parrot face / first deck card).
const faceVal = name => (FACES.indexOf(name) + 0.5) / FACES.length;
const faceRng = names => {
  const q = names.map(faceVal);
  let i = 0;
  return () => (i < q.length ? q[i++] : 0);
};

const die = f => ({ face: f, status: f === 'skull' ? 'skull' : 'active' });

// A ready-to-act "rolling" state with the given card and final dice faces.
function rolling(card, faces, { players = ['a', 'b'], turn = 'a', extra = [] } = {}) {
  return {
    players,
    currentIdx: players.indexOf(turn),
    turn,
    scores: Object.fromEntries(players.map(u => [u, 0])),
    target: 6000,
    finalRoundActive: false,
    winner: null,
    lastTurn: null,
    card,
    dice: [...faces.map(die), ...extra],
    sorceressUsed: false,
    rerollCount: 0,
    phase: 'rolling',
  };
}

const stop = s => applyMove(s, { action: 'stop' }, s.turn);

// ---- scoring --------------------------------------------------------------

test('set sizes score 3/4/5/6/7/8 = 100/200/500/1000/2000/4000', () => {
  const dice = n => Array.from({ length: n }, () => die('saber'));
  const plain = { type: 'sorceress' };
  assert.equal(scoreDice(dice(3), plain), 100);
  assert.equal(scoreDice(dice(4), plain), 200);
  assert.equal(scoreDice(dice(5), plain), 500);
  assert.equal(scoreDice(dice(6), plain), 1000);
  assert.equal(scoreDice(dice(7), plain), 2000);
  // 8 alike is also a full chest → 4000 + 500
  assert.equal(scoreDice(dice(8), plain), 4500);
});

test('coins and diamonds score +100 each, on top of any set', () => {
  const dice = ['coin', 'coin', 'coin', 'diamond', 'parrot'].map(die);
  // 3 coins = 100 (set) + 3×100 (coins) + 100 (diamond) = 500
  assert.equal(scoreDice(dice, { type: 'sorceress' }), 500);
});

test('animals card merges monkeys and parrots into one symbol', () => {
  const dice = ['monkey', 'monkey', 'parrot'].map(die);
  assert.equal(scoreDice(dice, { type: 'animals' }), 100);      // combined = 3
  assert.equal(scoreDice(dice, { type: 'sorceress' }), 0);      // separate = 2 + 1
});

test('a skull among the dice blocks the full-chest bonus', () => {
  const dice = [...Array(7).fill('saber'), 'skull'].map(die);
  assert.equal(scoreDice(dice, { type: 'sorceress' }), 2000);   // 7 sabers, no +500
});

// ---- bust -----------------------------------------------------------------

test('third skull busts the turn: 0 points, play passes on', () => {
  // two skulls already down, reroll two actives into two more skulls
  const s = rolling({ type: 'sorceress' },
    ['skull', 'skull', 'parrot', 'parrot', 'parrot', 'parrot', 'parrot', 'parrot']);
  const r = applyMove(s, { action: 'reroll', dice: [2, 3] }, 'a', faceRng(['skull', 'skull']));
  assert.equal(r.end, null);
  assert.equal(r.state.lastTurn.busted, true);
  assert.equal(r.state.lastTurn.points, 0);
  assert.equal(r.state.scores.a, 0);
  assert.equal(r.state.turn, 'b');
});

// ---- sea battle -----------------------------------------------------------

test('sea battle won: dice points + bonus', () => {
  const s = rolling({ type: 'seabattle', need: 2, bonus: 300 },
    ['saber', 'saber', 'coin', 'diamond', 'parrot', 'monkey', 'parrot', 'monkey']);
  const r = stop(s);
  assert.equal(r.state.lastTurn.points, 500);   // coin+diamond 200 + bonus 300
});

test('sea battle lost: pay the penalty, no dice points', () => {
  const s = rolling({ type: 'seabattle', need: 4, bonus: 1000 },
    ['saber', 'coin', 'coin', 'coin', 'diamond', 'parrot', 'monkey', 'parrot']);
  const r = stop(s);
  assert.equal(r.state.lastTurn.points, -1000);
  assert.equal(r.state.scores.a, -1000);
});

// ---- captain --------------------------------------------------------------

test('captain doubles the turn score', () => {
  const s = rolling({ type: 'captain' },
    ['saber', 'saber', 'saber', 'coin', 'parrot', 'monkey', 'parrot', 'monkey']);
  const r = stop(s);
  assert.equal(r.state.lastTurn.points, 400);   // (100 set + 100 coin) × 2
});

// ---- treasure chest -------------------------------------------------------

test('treasure chest: stored dice still score on a bust', () => {
  // 3 sabers already locked in the chest, 2 skulls down, reroll actives to bust
  const s = rolling({ type: 'chest' },
    ['parrot', 'parrot', 'skull', 'skull'],
    { extra: [
        { face: 'saber', status: 'chest' },
        { face: 'saber', status: 'chest' },
        { face: 'saber', status: 'chest' },
      ] });
  const r = applyMove(s, { action: 'reroll', dice: [0, 1] }, 'a', faceRng(['skull', 'skull']));
  assert.equal(r.state.lastTurn.busted, true);
  assert.equal(r.state.lastTurn.points, 100);   // the 3 chested sabers
});

// ---- sorceress ------------------------------------------------------------

test('sorceress rerolls a skull once, then is spent', () => {
  const s = rolling({ type: 'sorceress' },
    ['skull', 'parrot', 'parrot', 'monkey', 'monkey', 'coin', 'diamond', 'saber']);
  const r = applyMove(s, { action: 'sorceress', dice: [0] }, 'a', faceRng(['parrot']));
  assert.equal(r.state.dice[0].face, 'parrot');
  assert.equal(r.state.sorceressUsed, true);
  const again = applyMove(r.state, { action: 'sorceress', dice: [1] }, 'a', faceRng(['coin']));
  assert.equal(again.error, 'sorceress already used');
});

// ---- coin card + 9-of-a-kind instant win ----------------------------------

test('nine of a kind (via the coin card die) is an instant win', () => {
  const s = {
    players: ['a', 'b'], currentIdx: 0, turn: 'a',
    scores: { a: 0, b: 0 }, target: 6000, finalRoundActive: false,
    winner: null, lastTurn: null,
    card: { type: 'coin' },
    dice: [...Array(8).fill(null).map(() => ({ face: null, status: 'active' })),
           { face: 'coin', status: 'locked' }],
    sorceressUsed: false, rerollCount: 0, phase: 'awaitRoll',
  };
  const r = applyMove(s, { action: 'roll' }, 'a', faceRng(Array(8).fill('coin')));
  assert.equal(r.end.winner, 'a');
  assert.equal(r.state.winner, 'a');
});

// ---- final round + winner -------------------------------------------------

test('reaching the target triggers a final round, then highest score wins', () => {
  // a is on 5900; a set of 3 sabers (100) pushes a to 6000 → final round armed
  const s = rolling({ type: 'sorceress' },
    ['saber', 'saber', 'saber', 'parrot', 'monkey', 'parrot', 'monkey', 'parrot']);
  s.scores.a = 5900;
  const afterA = stop(s);
  assert.equal(afterA.end, null);            // b still gets a turn
  assert.equal(afterA.state.finalRoundActive, true);
  assert.equal(afterA.state.turn, 'b');

  // b stops with less → game ends, a wins
  const bState = { ...afterA.state,
    card: { type: 'sorceress' },
    dice: ['coin', 'parrot', 'monkey', 'parrot', 'monkey', 'saber', 'diamond', 'parrot'].map(die),
    phase: 'rolling' };
  const afterB = stop(bState);
  assert.equal(afterB.end.winner, 'a');
});

// ---- turn/roster plumbing -------------------------------------------------

test('init seats players in order and starts on the first player', () => {
  const s = init({ target: 4000 }, [{ user: 'x' }, { user: 'y' }, { user: 'z' }]);
  assert.deepEqual(s.players, ['x', 'y', 'z']);
  assert.equal(s.turn, 'x');
  assert.equal(s.target, 4000);
  assert.equal(s.phase, 'awaitRoll');
});

test('score maps the winner to a leaderboard row', () => {
  const rows = score({ winner: 'a', scores: { a: 6100, b: 3000 } },
    [{ user: 'a' }, { user: 'b' }, { user: 'c', spectator: true }]);
  assert.deepEqual(rows, [
    { user: 'a', result: 'win', points: 3 },
    { user: 'b', result: 'loss', points: 0 },
  ]);
});

test('not your turn is rejected', () => {
  const s = rolling({ type: 'sorceress' }, Array(8).fill('parrot'));
  assert.equal(applyMove(s, { action: 'stop' }, 'b').error, 'not your turn');
});

test('a reroll must include at least two dice', () => {
  const s = rolling({ type: 'sorceress' }, Array(8).fill('parrot'));
  assert.equal(applyMove(s, { action: 'reroll', dice: [0] }, 'a').error,
    'a reroll must include at least 2 dice');
});
