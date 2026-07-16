'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { STRATEGIES } = require('../cards/strategies');
const { scoreRound, scoreGame } = require('../scoring');

// --- card builders ---
const nigiri  = (variant, onWasabi = false) =>
  ({ type: 'nigiri', color: 'nigiri', variant, value: { egg: 1, salmon: 2, squid: 3 }[variant], onWasabi });
const maki    = (icons) => ({ type: 'maki',    color: 'maki',    icons });
const uramaki = (icons) => ({ type: 'uramaki', color: 'uramaki', icons });
const card    = (type)  => ({ type, color: type });
const temaki  = () => card('temaki');
const onigiri = (shape) => ({ type: 'onigiri', color: 'onigiri', shape });
const fruit   = (...fruits) => ({ type: 'fruit', color: 'fruit', fruits });

const player = (symbol, played = [], desserts = []) => ({ symbol, played, desserts });

// helper to score a single strategy for one player among a field
const roundOne = (players, symbol, playerCount = players.length, state = {}) =>
  scoreRound(players, playerCount, state)[symbol];

// === Nigiri ===
test('nigiri base values and wasabi tripling', () => {
  const p = player('X', [nigiri('egg'), nigiri('salmon'), nigiri('squid', true)]);
  // 1 + 2 + (3*3) = 12
  assert.equal(STRATEGIES.nigiri.scoreRound(p), 12);
});

// === Maki ===
test('maki: most=6 second=3 (<6 players), ties get full', () => {
  const players = [
    player('X', [maki(3), maki(2)]), // 5 icons
    player('O', [maki(2)]),          // 2 icons
    player('A', [maki(2)]),          // 2 icons (tie for 2nd)
  ];
  assert.equal(roundOne(players, 'X'), 6);
  assert.equal(roundOne(players, 'O'), 3);
  assert.equal(roundOne(players, 'A'), 3);
});

test('maki: 6-8 player tiers 6/4/2 and zero-maki scores nothing', () => {
  const players = [
    player('X', [maki(3)]), player('O', [maki(2)]), player('A', [maki(1)]),
    player('B', []), player('C', []), player('D', []),
  ];
  assert.equal(roundOne(players, 'X', 6), 6);
  assert.equal(roundOne(players, 'O', 6), 4);
  assert.equal(roundOne(players, 'A', 6), 2);
  assert.equal(roundOne(players, 'B', 6), 0);
});

// === Temaki ===
test('temaki: most +4, fewest -4, 2-player no penalty', () => {
  const three = [player('X', [temaki(), temaki()]), player('O', [temaki()]), player('A', [])];
  assert.equal(roundOne(three, 'X'), 4);
  assert.equal(roundOne(three, 'A'), -4);

  const two = [player('X', [temaki(), temaki()]), player('O', [])];
  assert.equal(roundOne(two, 'X', 2), 4);
  assert.equal(roundOne(two, 'O', 2), 0); // no penalty at 2 players
});

// === Uramaki ===
test('uramaki: end-of-round most gets next unclaimed place', () => {
  const players = [player('X', [uramaki(5), uramaki(4)]), player('O', [uramaki(3)])];
  assert.equal(roundOne(players, 'X', 2, { uramakiPlaceIndex: 0 }), 8);
  assert.equal(roundOne(players, 'O', 2, { uramakiPlaceIndex: 0 }), 0);
  // after two places claimed mid-round, end-of-round awards 3rd place (2 pts)
  assert.equal(roundOne(players, 'X', 2, { uramakiPlaceIndex: 2 }), 2);
});

// === Appetizers ===
test('tempura: sets of 2 → 5 each', () => {
  assert.equal(STRATEGIES.tempura.scoreRound(player('X', [card('tempura'), card('tempura'), card('tempura')])), 5);
});
test('sashimi: sets of 3 → 10 each', () => {
  const p = player('X', Array.from({ length: 6 }, () => card('sashimi')));
  assert.equal(STRATEGIES.sashimi.scoreRound(p), 20);
});
test('dumpling: 1/3/6/10/15 curve, capped', () => {
  const pts = n => STRATEGIES.dumpling.scoreRound(player('X', Array.from({ length: n }, () => card('dumpling'))));
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(pts), [0, 1, 3, 6, 10, 15, 15]);
});
test('eel: 1 = -3, 2+ = 7', () => {
  assert.equal(STRATEGIES.eel.scoreRound(player('X', [card('eel')])), -3);
  assert.equal(STRATEGIES.eel.scoreRound(player('X', [card('eel'), card('eel')])), 7);
});
test('tofu: 1=2, 2=6, 3+=0', () => {
  const pts = n => STRATEGIES.tofu.scoreRound(player('X', Array.from({ length: n }, () => card('tofu'))));
  assert.deepEqual([0, 1, 2, 3].map(pts), [0, 2, 6, 0]);
});
test('onigiri: unique-shape sets 1/4/9/16 + multiple sets', () => {
  const s = shapes => STRATEGIES.onigiri.scoreRound(player('X', shapes.map(onigiri)));
  assert.equal(s(['circle']), 1);
  assert.equal(s(['circle', 'triangle']), 4);
  assert.equal(s(['circle', 'triangle', 'square']), 9);
  assert.equal(s(['circle', 'triangle', 'square', 'rectangle']), 16);
  // two sets: {c,t} + leftover c → 4 + 1 = 5
  assert.equal(s(['circle', 'triangle', 'circle']), 5);
});
test('edamame: 1 pt per opponent with edamame, max 4', () => {
  const players = [
    player('X', [card('edamame'), card('edamame')]),
    player('O', [card('edamame')]),
    player('A', []),
  ];
  // X: 2 cards × 1 opponent (O) = 2
  assert.equal(roundOne(players, 'X'), 2);
  // O: 1 card × 1 opponent (X) = 1
  assert.equal(roundOne(players, 'O'), 1);
});
test('miso: 3 each (survivors)', () => {
  assert.equal(STRATEGIES.miso.scoreRound(player('X', [card('miso'), card('miso')])), 6);
});

// === Specials ===
test('soy sauce: 4 pts if most distinct colors, per card, ties count', () => {
  const players = [
    player('X', [card('soy_sauce'), card('tempura'), card('eel')]),   // 3 colors
    player('O', [card('tofu'), card('tofu')]),                        // 1 color
  ];
  const ctx = { players, playerCount: 2, state: {} };
  assert.equal(STRATEGIES.soy_sauce.scoreRound(players[0], ctx), 4);
  assert.equal(STRATEGIES.soy_sauce.scoreRound(players[1], ctx), 0);
});
test('tea: 1 pt per card in largest single-color group, per tea card', () => {
  // 1 tea + 3 tempura → largest group is tempura(3) → 1 tea × 3 = 3
  const p = player('X', [card('tea'), card('tempura'), card('tempura'), card('tempura')]);
  assert.equal(STRATEGIES.tea.scoreRound(p, { players: [p], playerCount: 1, state: {} }), 3);
});
test('takeout box: flipped cards worth 2 each and lose identity', () => {
  const flipped = { ...card('eel'), flipped: true };
  const p = player('X', [flipped, flipped, card('eel')]);
  // 2 flipped → 4 pts; remaining single eel → -3 ; total 1
  assert.equal(roundOne([p], 'X', 1), 1);
});

// === Desserts (end of game) ===
test('pudding: most +6, fewest -6, not at 2 players', () => {
  const players = [
    player('X', [], [card('pudding'), card('pudding')]),
    player('O', [], [card('pudding')]),
    player('A', [], []),
  ];
  const g = scoreGame(players, 3, 'pudding');
  assert.equal(g.X, 6);
  assert.equal(g.A, -6);

  const two = scoreGame([
    player('X', [], [card('pudding'), card('pudding')]),
    player('O', [], []),
  ], 2, 'pudding');
  assert.equal(two.O, 0);
});
test('green tea ice cream: sets of 4 → 12', () => {
  const p = player('X', [], Array.from({ length: 9 }, () => card('green_tea_ice_cream')));
  assert.equal(STRATEGIES.green_tea_ice_cream.scoreGame(p), 24);
});
test('fruit: per-type icon table incl 0-icon penalty', () => {
  // 5 watermelon, 0 orange, 0 pineapple → 10 + (-2) + (-2) = 6
  const p = player('X', [], [fruit('watermelon', 'watermelon'), fruit('watermelon', 'watermelon'), fruit('watermelon', 'orange')]);
  // watermelon=5 →10, orange=1 →0, pineapple=0 →-2  => 8
  assert.equal(STRATEGIES.fruit.scoreGame(p), 8);
  // no fruit at all → -2 ×3 = -6
  assert.equal(STRATEGIES.fruit.scoreGame(player('X', [], [])), -6);
});
