'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MENUS, dealCount, dessertCount, resolveMenu, validateMenu,
  baseDeck, dessertPool, makeRng, shuffle,
} = require('../deck');

test('deal counts by player count', () => {
  assert.equal(dealCount(2), 10);
  assert.equal(dealCount(3), 10);
  assert.equal(dealCount(4), 9);
  assert.equal(dealCount(5), 9);
  assert.equal(dealCount(6), 8);
  assert.equal(dealCount(7), 8);
  assert.equal(dealCount(8), 7);
});

test('dessert counts per round by group', () => {
  // 2–5 players
  assert.deepEqual([1, 2, 3].map(r => dessertCount(4, r)), [5, 3, 2]);
  // 6–8 players
  assert.deepEqual([1, 2, 3].map(r => dessertCount(6, r)), [7, 5, 3]);
});

test('all 8 predefined menus resolve and validate', () => {
  for (const preset of Object.keys(MENUS)) {
    const menu = resolveMenu({ preset }, 3);
    assert.equal(menu.appetizers.length, 3);
    assert.equal(menu.specials.length, 2);
  }
});

test('menu restriction: Spoon/Edamame banned at 2 players', () => {
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['edamame', 'tempura', 'tofu'], specials: ['wasabi', 'tea'], dessert: 'pudding' }, 2));
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['tempura', 'sashimi', 'tofu'], specials: ['spoon', 'tea'], dessert: 'pudding' }, 2));
});

test('menu restriction: Menu/Special Order banned at 7–8 players', () => {
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['tempura', 'sashimi', 'tofu'], specials: ['menu', 'tea'], dessert: 'pudding' }, 7));
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['tempura', 'sashimi', 'tofu'], specials: ['special_order', 'tea'], dessert: 'pudding' }, 8));
});

test('menu composition must be exactly 1/3/2/1', () => {
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['tempura', 'sashimi'], specials: ['wasabi', 'tea'], dessert: 'pudding' }, 3));
  assert.throws(() => validateMenu(
    { roll: 'maki', appetizers: ['tempura', 'sashimi', 'tofu'], specials: ['wasabi'], dessert: 'pudding' }, 3));
  assert.throws(() => validateMenu(
    { roll: 'bad_roll', appetizers: ['tempura', 'sashimi', 'tofu'], specials: ['wasabi', 'tea'], dessert: 'pudding' }, 3));
});

test('base deck excludes desserts and has 54 cards', () => {
  const menu = resolveMenu({ preset: 'classic' }, 3);
  const deck = baseDeck(menu);
  // nigiri 12 + maki 12 + (3 appetizers × 8 = 24) + (2 specials × 3 = 6) = 54
  assert.equal(deck.length, 54);
  assert.ok(deck.every(c => c.type !== menu.dessert));
});

test('dessert pool is 15 cards of the menu dessert type', () => {
  const menu = resolveMenu({ preset: 'classic' }, 3);
  const pool = dessertPool(menu);
  assert.equal(pool.length, 15);
  assert.ok(pool.every(c => c.type === 'pudding'));
});

test('seeded shuffle is deterministic and non-mutating', () => {
  const src = Array.from({ length: 20 }, (_, i) => i);
  const a = shuffle(src, makeRng(42));
  const b = shuffle(src, makeRng(42));
  assert.deepEqual(a, b);
  assert.deepEqual(src, Array.from({ length: 20 }, (_, i) => i)); // unchanged
  assert.notDeepEqual(a, src); // actually shuffled
  assert.deepEqual([...a].sort((x, y) => x - y), src); // same multiset
});
