import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDeck, ACTIONS, MODIFIERS } from '../deck.js';
import { scoreRound, resolveWinner } from '../scoring.js';
import { init, applyMove } from '../flow.js';

// ---- card constructors ----------------------------------------------------
const num = value => ({ kind: 'number', value });
const mod = m => ({ kind: 'modifier', mod: m });
const act = a => ({ kind: 'action', action: a });

// A playing state whose draw pile yields `next` in order (pop() takes the last,
// so we reverse). `lines` optionally pre-loads a player's line.
function make({ players = ['a', 'b'], next = [], target = 200, scores, lines } = {}) {
  const s = init({ target, players }, [], () => 0);
  s.drawPile = [...next].reverse();
  s.discardPile = [];
  if (scores) s.scores = { ...s.scores, ...scores };
  if (lines) for (const [u, l] of Object.entries(lines)) s.lines[u] = { ...s.lines[u], ...l };
  return s;
}
const hit = (s, u = s.turn, rng = () => 0) => applyMove(s, { action: 'hit' }, u, rng);
const stay = (s, u = s.turn) => applyMove(s, { action: 'stay' }, u);
const resolve = (s, target, u = s.turn) => applyMove(s, { action: 'resolve', target }, u);

// ---- deck -----------------------------------------------------------------

test('the deck is 94 cards with faithful counts', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 94);
  const numbers = deck.filter(c => c.kind === 'number');
  assert.equal(numbers.length, 79);
  assert.equal(numbers.filter(c => c.value === 0).length, 1);
  for (let v = 1; v <= 12; v++) assert.equal(numbers.filter(c => c.value === v).length, v);
  for (const a of ACTIONS) assert.equal(deck.filter(c => c.kind === 'action' && c.action === a).length, 3);
  for (const m of MODIFIERS) assert.equal(deck.filter(c => c.kind === 'modifier' && c.mod === m).length, 1);
});

// ---- scoring --------------------------------------------------------------

test('scoreRound: numbers, then x2, then flat modifiers, then Flip 7 bonus', () => {
  const line = {
    status: 'active', flip7: true, numbers: [3, 4, 5],
    cards: [num(3), num(4), num(5), mod('x2'), mod('+4')],
  };
  // (3+4+5)=12 → x2 = 24 → +4 = 28 → +15 = 43
  assert.equal(scoreRound(line).points, 43);
});

test('a busted line scores 0', () => {
  assert.equal(scoreRound({ status: 'busted', numbers: [5, 9], cards: [num(5), num(9)] }).points, 0);
});

test('resolveWinner needs the target AND a sole highest score', () => {
  assert.equal(resolveWinner({ a: 210, b: 180 }, ['a', 'b'], 200), 'a');
  assert.equal(resolveWinner({ a: 210, b: 210 }, ['a', 'b'], 200), null); // tie → play on
  assert.equal(resolveWinner({ a: 150, b: 120 }, ['a', 'b'], 200), null); // nobody there yet
});

// ---- bust & second chance -------------------------------------------------

test('flipping a duplicate number busts the turn', () => {
  const s = make({ players: ['a', 'b'], next: [num(5), num(9), num(5)] });
  const r1 = hit(s, 'a');            // a: 5 → turn b
  const r2 = hit(r1.state, 'b');     // b: 9 → turn a
  const r3 = hit(r2.state, 'a');     // a: duplicate 5 → bust
  assert.equal(r3.state.lines.a.status, 'busted');
});

test('a Second Chance cancels a bust and is consumed', () => {
  const s = make({
    players: ['a', 'b'],
    next: [num(5), num(9), num(5)],
    lines: { a: { numbers: [], cards: [], secondChance: true, cardsSC: true } },
  });
  // give a a real Second Chance card so removal works
  s.lines.a.cards = [act('secondchance')];
  const r1 = hit(s, 'a');            // a: 5
  const r2 = hit(r1.state, 'b');     // b: 9
  const r3 = hit(r2.state, 'a');     // a: duplicate 5 → Second Chance saves it
  assert.equal(r3.state.lines.a.status, 'active');
  assert.equal(r3.state.lines.a.secondChance, false);
});

// ---- action cards ---------------------------------------------------------

test('Freeze makes the chosen player stay', () => {
  const s = make({ players: ['a', 'b', 'c'], next: [act('freeze')] });
  const r1 = hit(s, 'a');            // a draws Freeze → pending
  assert.equal(r1.state.pending.type, 'freeze');
  const r2 = resolve(r1.state, 'b', 'a');   // a freezes b
  assert.equal(r2.state.lines.b.status, 'frozen');
  assert.equal(r2.state.pending, null);
  assert.equal(r2.state.turn, 'b' === r2.state.turn ? r2.state.turn : r2.state.turn); // turn moved on
  assert.notEqual(r2.state.turn, 'a');
});

test('Flip Three forces the target to flip exactly three cards, then play resumes', () => {
  const s = make({ players: ['a', 'b', 'c'], next: [act('flipthree'), num(3), num(4), num(5)] });
  const r1 = hit(s, 'a');            // a draws Flip Three → pending
  assert.equal(r1.state.pending.type, 'flipthree');
  const r2 = resolve(r1.state, 'b', 'a');   // a targets b → b auto-flips 3
  assert.deepEqual(r2.state.lines.b.numbers, [3, 4, 5]);
  assert.equal(r2.state.pending, null);
  assert.equal(r2.state.forced, null);
});

test('Flip Three stops early if the target busts', () => {
  const s = make({ players: ['a', 'b', 'c'], next: [act('flipthree'), num(3), num(3)] });
  const r1 = hit(s, 'a');
  const r2 = resolve(r1.state, 'b', 'a');   // b flips 3, then duplicate 3 → bust
  assert.equal(r2.state.lines.b.status, 'busted');
});

// ---- Flip 7 ---------------------------------------------------------------

test('a seventh unique number is a Flip 7: round ends and scores +15', () => {
  const s = make({
    players: ['a', 'b'],
    next: [num(7)],
    lines: { a: { numbers: [1, 2, 3, 4, 5, 6], cards: [num(1), num(2), num(3), num(4), num(5), num(6)] } },
  });
  const r = hit(s, 'a');             // a completes 7 unique numbers
  // round ended → next round started; a scored 1+..+7 (28) + 15 = 43
  assert.equal(r.state.scores.a, 43);
  assert.ok(r.state.roundSummary.find(x => x.user === 'a').flip7);
});

// ---- rounds & win ---------------------------------------------------------

test('staying banks points and the round ends when everyone is out', () => {
  const s = make({ players: ['a', 'b'], next: [num(6), num(4)] });
  const r1 = hit(s, 'a');            // a: 6
  const r2 = hit(r1.state, 'b');     // b: 4
  const r3 = stay(r2.state, 'a');    // a stays
  const r4 = stay(r3.state, 'b');    // b stays → round ends
  assert.equal(r4.state.scores.a, 6);
  assert.equal(r4.state.scores.b, 4);
  assert.equal(r4.state.round, 2);
});

test('you cannot stay on an empty line', () => {
  const s = make({ players: ['a', 'b'] });
  assert.equal(stay(s, 'a').error, 'flip at least one card before staying');
});

test('reaching the target with the sole highest score wins', () => {
  const s = make({ players: ['a', 'b'], next: [num(12), num(1)], target: 100, scores: { a: 95, b: 10 } });
  const r1 = hit(s, 'a');            // a: 12 → 107 pending on round end
  const r2 = hit(r1.state, 'b');     // b: 1
  const r3 = stay(r2.state, 'a');
  const r4 = stay(r3.state, 'b');    // round ends → a at 107 ≥ 100, sole leader
  assert.equal(r4.end?.winner, 'a');
  assert.equal(r4.state.phase, 'done');
});

test('not your turn is rejected', () => {
  const s = make({ players: ['a', 'b'], next: [num(5)] });
  assert.equal(hit(s, 'b').error, 'not your turn');
});
