'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const game = require('../game');

test('exposes the required platform interface', () => {
  assert.equal(typeof game.meta, 'object');
  assert.equal(typeof game.init, 'function');
  assert.equal(typeof game.applyMove, 'function');
  assert.equal(game.meta.minPlayers, 2);
  assert.ok(game.meta.maxPlayers >= 2);
  assert.ok(Array.isArray(game.settingsSchema.preset.values));
});

test('init + applyMove round-trip through the module', () => {
  const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
  assert.equal(s.hands.X.length, 10);
  const r = game.applyMove(s, { pick: 0 }, 'X');
  assert.equal(r.end, null);
});

test('score maps a single winner to win/loss with points', () => {
  const end = { winner: 'X', ranking: [
    { symbol: 'X', score: 40, desserts: 3 },
    { symbol: 'O', score: 25, desserts: 2 },
  ]};
  const players = [{ user: 'alice', symbol: 'X' }, { user: 'bob', symbol: 'O' }];
  const scores = game.score(end, players);
  assert.deepEqual(scores, [
    { user: 'alice', result: 'win', points: 40 },
    { user: 'bob', result: 'loss', points: 25 },
  ]);
});

test('score marks a shared top (same score & desserts) as draw', () => {
  const end = { winner: 'draw', ranking: [
    { symbol: 'X', score: 30, desserts: 2 },
    { symbol: 'O', score: 30, desserts: 2 },
  ]};
  const players = [{ user: 'a', symbol: 'X' }, { user: 'b', symbol: 'O' }];
  const scores = game.score(end, players);
  assert.ok(scores.every(s => s.result === 'draw'));
});

test('score ignores spectators', () => {
  const end = { winner: 'X', ranking: [{ symbol: 'X', score: 10, desserts: 1 }] };
  const players = [{ user: 'a', symbol: 'X' }, { user: 'c', symbol: 'spectator' }];
  const scores = game.score(end, players);
  assert.equal(scores.length, 1);
  assert.equal(scores[0].user, 'a');
});

test('publicState hides all hidden information', () => {
  const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
  const pub = game.publicState(s);
  assert.equal(pub.hands, undefined);
  assert.equal(pub.drawPile, undefined);
  assert.equal(pub.dessertPool, undefined);
  assert.equal(pub.pending, undefined);
  assert.equal(pub.handCounts.X, 10);
  assert.equal(pub.handCounts.O, 10);
  assert.equal(pub.selected.X, false);
});

test('publicState reveals only that a player has selected, not what', () => {
  const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
  game.applyMove(s, { pick: 3 }, 'X');
  const pub = game.publicState(s);
  assert.equal(pub.selected.X, true);
  assert.equal(pub.selected.O, false);
  assert.equal(pub.pendingCount, 1);
  // the actual picked card index must not leak anywhere in the public payload
  assert.ok(!JSON.stringify(pub).includes('"pick"'));
});

test('privateState exposes only the requesting player hand', () => {
  const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
  const priv = game.privateState(s, 'X');
  assert.equal(priv.myHand.length, 10);
  assert.equal(priv.hands, undefined);
  assert.equal(priv.handCounts.O, 10);
  // O's actual cards are not present
  assert.equal(priv.myHandForO, undefined);
});
