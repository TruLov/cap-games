/**
 * Flip Fortune — the deck (pure, no CAP imports).
 *
 * 94 cards, faithful to the press-your-luck game that inspired it:
 *   - Number cards 0-12 where each value's count equals the value, plus one 0
 *     → 79 number cards (one 0, one 1, two 2s, … twelve 12s).
 *   - Action cards: Freeze ×3, Flip Three ×3, Second Chance ×3 → 9.
 *   - Modifier cards: +2, +4, +6, +8, +10, ×2 (one each) → 6.
 *
 * Cards:
 *   { kind:'number',   value }                       value 0..12
 *   { kind:'modifier', mod }                         mod '+2'|'+4'|'+6'|'+8'|'+10'|'x2'
 *   { kind:'action',   action }                      action 'freeze'|'flipthree'|'secondchance'
 *
 * Unlike a uniform random draw, this is a real finite pile: `flow.js` draws from
 * the top and reshuffles the discard back in when it runs out, so bust odds stay
 * faithful to the physical deck.
 */

export const ACTIONS = ['freeze', 'flipthree', 'secondchance'];
export const MODIFIERS = ['+2', '+4', '+6', '+8', '+10', 'x2'];

// Flat point value of an additive modifier ('x2' has no flat value → 0).
export const MOD_VALUE = { '+2': 2, '+4': 4, '+6': 6, '+8': 8, '+10': 10, x2: 0 };

export function buildDeck() {
  const deck = [];
  deck.push({ kind: 'number', value: 0 });
  for (let v = 1; v <= 12; v++) {
    for (let n = 0; n < v; n++) deck.push({ kind: 'number', value: v });
  }
  for (const action of ACTIONS) {
    for (let n = 0; n < 3; n++) deck.push({ kind: 'action', action });
  }
  for (const mod of MODIFIERS) deck.push({ kind: 'modifier', mod });
  return deck;
}

// Fisher-Yates using an injectable rng (returns a float in [0, 1); defaults to
// Math.random). Returns a new array; the input is not mutated.
export function shuffle(deck, rng = Math.random) {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
