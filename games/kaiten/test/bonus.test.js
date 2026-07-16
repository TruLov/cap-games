'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const flow = require('../flow');
const game = require('../game');

const card = (t) => ({ type: t, color: t });
const filler = () => card('maki'); // harmless roll card used as padding

// ============================ SPOON ============================

test('spoon pulls the named card from the first left-neighbour who has it', () => {
  const s = flow.init({ players: ['X', 'O', 'A'], preset: 'master_menu', seed: 1 });
  // X already played an (unused) Spoon on a previous turn
  s.played.X = [card('spoon')];
  // craft hands so nobody keeps the tofu before the spoon looks for it
  s.hands.X = [card('sashimi'), filler()];
  s.hands.O = [card('sashimi'), card('tofu')]; // O keeps sashimi, tofu remains
  s.hands.A = [filler(), filler()];
  s.pending = {};

  flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'tofu' }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');
  flow.applyMove(s, { pick: 0 }, 'A');

  // X played their own kept card AND the spooned tofu
  assert.ok(s.played.X.some(c => c.type === 'sashimi'), 'X kept sashimi');
  assert.ok(s.played.X.some(c => c.type === 'tofu'), 'X gained the spooned tofu');
  // the Spoon left X and was given to O (the giver), unused
  assert.ok(!s.played.X.some(c => c.type === 'spoon'), 'spoon left X');
  assert.ok(s.played.O.some(c => c.type === 'spoon'), 'spoon given to O');
  // O no longer holds the tofu
  assert.ok(!s.hands.O.some(c => c.type === 'tofu'), 'tofu taken from O');
});

test('spoon is discarded when no one holds the named card', () => {
  const s = flow.init({ players: ['X', 'O', 'A'], preset: 'master_menu', seed: 2 });
  s.played.X = [card('spoon')];
  s.hands.X = [card('sashimi'), filler()];
  s.hands.O = [filler(), filler()];
  s.hands.A = [filler(), filler()];
  s.pending = {};

  flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'eel' }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O');
  flow.applyMove(s, { pick: 0 }, 'A');

  assert.ok(!s.played.X.some(c => c.type === 'spoon'), 'spoon discarded');
  assert.ok(!s.played.O.some(c => c.type === 'spoon'));
  assert.ok(!s.played.A.some(c => c.type === 'spoon'));
  assert.ok(s.played.X.some(c => c.type === 'sashimi'), 'X still kept their card');
});

test('spoon requires an unused spoon in front of the player', () => {
  const s = flow.init({ players: ['X', 'O', 'A'], preset: 'master_menu', seed: 3 });
  s.played.X = []; // no spoon
  s.pending = {};
  const r = flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'tofu' }, 'X');
  assert.match(r.error, /no spoon/i);
});

// ============================ MENU ============================

test('menu offers 4 cards, plays the chosen one, returns the rest', () => {
  const s = flow.init({ players: ['X', 'O'], preset: 'party_sampler', seed: 4 });
  s.played.X = [];
  s.hands.X = [card('menu'), filler()];
  s.hands.O = [filler(), filler()];
  s.pending = {};
  s.drawPile = [card('tempura'), card('dumpling'), card('tofu'), card('tempura'), card('eel')];
  const drawBefore = s.drawPile.length;

  // step 1 — play Menu: 4 cards are offered, turn does NOT resolve yet
  const r1 = flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X');
  assert.equal(r1.end, null);
  assert.equal(s.menuOffer.X.length, 4, '4 cards offered');
  assert.ok(!s.pending.X, 'pending not set until the choice is made');
  assert.equal(s.drawPile.length, drawBefore - 4);

  // step 2 — choose index 2 (tofu)
  const chosenType = s.menuOffer.X[2].type;
  flow.applyMove(s, { menuChoice: 2 }, 'X');
  flow.applyMove(s, { pick: 0 }, 'O'); // O completes the turn

  assert.ok(s.played.X.some(c => c.type === chosenType), 'chosen card played');
  assert.ok(!s.played.X.some(c => c.type === 'menu'), 'menu card discarded');
  // 3 of the 4 returned to the draw pile → net one card left the pile
  assert.equal(s.drawPile.length, drawBefore - 1);
});

test('menu cannot choose another Menu card', () => {
  const s = flow.init({ players: ['X', 'O'], preset: 'party_sampler', seed: 5 });
  s.played.X = [];
  s.hands.X = [card('menu'), filler()];
  s.hands.O = [filler(), filler()];
  s.pending = {};
  s.drawPile = [card('menu'), card('tofu'), card('eel'), card('dumpling')];

  flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X');
  const r = flow.applyMove(s, { menuChoice: 0 }, 'X'); // index 0 is a Menu
  assert.match(r.error, /another Menu/i);
});

test('a normal move is blocked while a Menu selection is pending', () => {
  const s = flow.init({ players: ['X', 'O'], preset: 'party_sampler', seed: 6 });
  s.played.X = [];
  s.hands.X = [card('menu'), filler()];
  s.hands.O = [filler(), filler()];
  s.pending = {};
  s.drawPile = [card('tofu'), card('eel'), card('dumpling'), card('tempura')];

  flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X');
  const r = flow.applyMove(s, { pick: 0 }, 'X');
  assert.match(r.error, /resolve your Menu/i);
});

// ============================ PROJECTION ============================

test('menu offer is private: hidden in publicState, present only for its owner', () => {
  const s = flow.init({ players: ['X', 'O'], preset: 'party_sampler', seed: 7 });
  s.menuOffer = { X: [card('tofu'), card('eel')] };

  const pub = game.publicState(s);
  assert.equal(pub.menuOffer, undefined, 'menu offer must not be public');

  assert.deepEqual(game.privateState(s, 'X').menuOffer, s.menuOffer.X, 'owner sees their offer');
  assert.equal(game.privateState(s, 'O').menuOffer, undefined, 'others do not see it');
});
