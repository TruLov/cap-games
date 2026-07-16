'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../flow');

const START = (players, extra = {}) =>
  flow.init({ players, preset: 'sushi_go', seed: 12345, ...extra });

test('init deals correct hand sizes and sets up state', () => {
  const s = START(['X', 'O']);
  assert.equal(s.phase, 'playing');
  assert.equal(s.turn, 'all');
  assert.equal(s.round, 1);
  assert.equal(s.hands.X.length, 10);
  assert.equal(s.hands.O.length, 10);
  // base deck 54 + 5 desserts (round 1, 2 players) = 59; 20 dealt → 39 in draw pile
  assert.equal(s.drawPile.length, 59 - 20);
});

test('init rejects fewer than 2 players', () => {
  assert.throws(() => flow.init({ players: ['X'], preset: 'sushi_go' }));
});

test('applyMove buffers until all players have selected', () => {
  const s = START(['X', 'O']);
  const r1 = flow.applyMove(s, { pick: 0 }, 'X');
  assert.equal(r1.end, null);
  assert.equal(s.pending.X.pick, 0);
  assert.ok(!s.pending.O);
  // X cannot select twice
  const dup = flow.applyMove(s, { pick: 1 }, 'X');
  assert.match(dup.error, /already selected/);
});

test('turn resolves and rotates hands when all selected', () => {
  const s = START(['X', 'O']);
  const xHandBefore = [...s.hands.X];
  const oHandBefore = [...s.hands.O];

  flow.applyMove(s, { pick: 0 }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');

  // each kept 1 card, hands rotated → 9 cards each
  assert.equal(s.hands.X.length, 9);
  assert.equal(s.hands.O.length, 9);
  // X now holds O's former remaining hand (pass left)
  assert.deepEqual(s.hands.X, oHandBefore.slice(1));
  assert.deepEqual(s.hands.O, xHandBefore.slice(1));
  // one card each was played
  assert.equal(s.played.X.length, 1);
  assert.equal(s.played.O.length, 1);
  assert.equal(Object.keys(s.pending).length, 0);
});

test('nigiri auto-places on an unoccupied wasabi and triples', () => {
  const s = flow.init({ players: ['X', 'O'], preset: 'sushi_go', seed: 1 });
  // craft hands directly for a deterministic scenario
  s.hands.X = [{ type: 'wasabi', color: 'wasabi' }, { type: 'nigiri', color: 'nigiri', variant: 'squid', value: 3 }];
  s.hands.O = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }];

  // turn 1: X plays wasabi, O plays a maki
  flow.applyMove(s, { pick: 0 }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');
  assert.equal(s.played.X[0].type, 'wasabi');

  // turn 2: X plays the nigiri (extra filler card keeps the round going)
  s.hands.X = [{ type: 'nigiri', color: 'nigiri', variant: 'squid', value: 3 }, { type: 'maki', color: 'maki', icons: 1 }];
  s.hands.O = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }];
  flow.applyMove(s, { pick: 0 }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');

  const nigiri = s.played.X.find(c => c.type === 'nigiri');
  assert.equal(nigiri.onWasabi, true);
  assert.equal(s.played.X.find(c => c.type === 'wasabi').occupied, true);
});

test('a full round advances to round 2 and re-deals', () => {
  const s = START(['X', 'O']);
  // play all 10 turns (each player always picks index 0)
  for (let i = 0; i < 10; i++) {
    flow.applyMove(s, { pick: 0 }, 'X');
    const r = flow.applyMove(s, { pick: 0 }, 'O');
    if (i < 9) assert.equal(r.end, null);
  }
  assert.equal(s.round, 2);
  assert.equal(s.hands.X.length, 10); // fresh deal
  assert.ok(s.roundScores.X[0] != null); // round 1 scored
});

test('a full 3-round game ends with a ranking and winner', () => {
  const s = START(['X', 'O']);
  let end = null;
  for (let round = 0; round < 3; round++) {
    for (let i = 0; i < 10; i++) {
      flow.applyMove(s, { pick: 0 }, 'X');
      const r = flow.applyMove(s, { pick: 0 }, 'O');
      if (r.end) end = r.end;
    }
  }
  assert.ok(end, 'game should end');
  assert.equal(s.phase, 'gameOver');
  assert.equal(end.ranking.length, 2);
  assert.ok(['X', 'O', 'draw'].includes(end.winner));
  // ranking sorted by score desc
  assert.ok(end.ranking[0].score >= end.ranking[1].score);
});

test('rejects moves after the game is over', () => {
  const s = START(['X', 'O']);
  for (let round = 0; round < 3; round++)
    for (let i = 0; i < 10; i++) {
      flow.applyMove(s, { pick: 0 }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
    }
  const r = flow.applyMove(s, { pick: 0 }, 'X');
  assert.match(r.error, /not in progress/);
});

test('state is JSON-serializable after a turn', () => {
  const s = START(['X', 'O', 'A']);
  flow.applyMove(s, { pick: 0 }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');
  flow.applyMove(s, { pick: 0 }, 'A');
  assert.doesNotThrow(() => JSON.stringify(s));
});
