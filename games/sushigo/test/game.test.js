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
  const s = game.init({ players: ['X', 'O'], preset: 'sushi_go', seed: 7 });
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

test('view hides other hands but exposes own hand + counts', () => {
  const s = game.init({ players: ['X', 'O'], preset: 'sushi_go', seed: 7 });
  const v = game.view(s, 'X');
  assert.equal(v.hands, undefined);
  assert.equal(v.myHand.length, 10);
  assert.equal(v.handCounts.O, 10);
  assert.equal(v.hasSelected, false);
});
