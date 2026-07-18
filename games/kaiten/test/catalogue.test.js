'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { CARD_TYPES, cardsOfType, ONIGIRI_SHAPES } = require('../cards/catalogue');

test('full pool totals 181 cards across all types', () => {
  const total = Object.keys(CARD_TYPES)
    .reduce((sum, type) => sum + cardsOfType(type).length, 0);
  assert.equal(total, 181);
});

test('each type produces exactly its declared count', () => {
  for (const [type, meta] of Object.entries(CARD_TYPES)) {
    assert.equal(cardsOfType(type).length, meta.count, `${type} count`);
  }
});

test('nigiri variants carry correct point values', () => {
  const nigiri = cardsOfType('nigiri');
  const byVariant = Object.groupBy(nigiri, c => c.variant);
  assert.equal(byVariant.egg.length, 4);
  assert.equal(byVariant.salmon.length, 5);
  assert.equal(byVariant.squid.length, 3);
  assert.equal(byVariant.egg[0].value, 1);
  assert.equal(byVariant.salmon[0].value, 2);
  assert.equal(byVariant.squid[0].value, 3);
});

test('maki cards show 1, 2 or 3 icons', () => {
  const maki = cardsOfType('maki');
  assert.ok(maki.every(c => [1, 2, 3].includes(c.icons)));
  assert.equal(maki.length, 12);
});

test('uramaki cards show 3, 4 or 5 icons', () => {
  const uramaki = cardsOfType('uramaki');
  assert.ok(uramaki.every(c => [3, 4, 5].includes(c.icons)));
});

test('onigiri has 2 of each of 4 shapes', () => {
  const onigiri = cardsOfType('onigiri');
  const byShape = Object.groupBy(onigiri, c => c.shape);
  for (const shape of ONIGIRI_SHAPES) assert.equal(byShape[shape].length, 2);
});

test('fruit cards each show 2 fruit icons', () => {
  const fruit = cardsOfType('fruit');
  assert.equal(fruit.length, 15);
  assert.ok(fruit.every(c => c.fruits.length === 2));
});

test('every card carries a color equal to its type', () => {
  for (const type of Object.keys(CARD_TYPES)) {
    assert.ok(cardsOfType(type).every(c => c.color === type), `${type} color`);
  }
});

test('unknown card type throws', () => {
  assert.throws(() => cardsOfType('does_not_exist'));
});
