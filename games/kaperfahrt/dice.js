/**
 * Kaperfahrt — dice faces + scoring (pure, no CAP imports).
 *
 * Eight dice, six faces. Sets of identical symbols score by size; gold coins
 * and diamonds each also score +100 individually; scoring on all dice at once
 * ("full chest") adds +500. Skulls never score. The "animals" card merges
 * monkeys and parrots into a single symbol for set-counting.
 */

export const FACES = ['parrot', 'monkey', 'saber', 'coin', 'diamond', 'skull'];

export const SET_POINTS = { 3: 100, 4: 200, 5: 500, 6: 1000, 7: 2000, 8: 4000 };

// One random face. `rng` returns a float in [0, 1) (defaults to Math.random);
// injectable so tests can script exact rolls.
export function rollFace(rng = Math.random) {
  return FACES[Math.min(FACES.length - 1, Math.floor(rng() * FACES.length))];
}

// Monkeys + parrots collapse to one symbol only under the "animals" card.
const keyOf = (face, card) =>
  card?.type === 'animals' && (face === 'monkey' || face === 'parrot') ? 'animal' : face;

// Counts of each (non-skull, rolled) symbol among the given dice.
export function symbolCounts(dice, card) {
  const counts = {};
  for (const d of dice) {
    if (!d.face || d.face === 'skull') continue;
    const k = keyOf(d.face, card);
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

// Largest identical-symbol group — used to detect a 9-of-a-kind instant win.
export function maxSet(dice, card) {
  return Object.values(symbolCounts(dice, card)).reduce((m, n) => Math.max(m, n), 0);
}

// Number of skulls currently showing (locked, count toward the 3-skull bust).
export const skullCount = dice => dice.filter(d => d.face === 'skull').length;

/**
 * Itemised score for the given dice. Caller decides *which* dice are eligible
 * (all current dice on a clean stop, or only chest-protected dice on a bust).
 * Skulls among them are ignored for scoring but do block the full-chest bonus.
 * Returns `{ lines: [{ label, points }], total }` — the lines drive the
 * turn-end summary; `scoreDice` is just the total.
 */
export function scoreBreakdown(dice, card) {
  const counts = symbolCounts(dice, card);
  const lines = [];

  for (const [sym, n] of Object.entries(counts)) {
    if (n >= 3) lines.push({ label: `Set of ${n} ${sym}`, points: SET_POINTS[Math.min(n, 8)] });
  }
  const coins = dice.filter(d => d.face === 'coin').length;
  const diamonds = dice.filter(d => d.face === 'diamond').length;
  if (coins) lines.push({ label: `${coins} gold coin${coins > 1 ? 's' : ''}`, points: 100 * coins });
  if (diamonds) lines.push({ label: `${diamonds} diamond${diamonds > 1 ? 's' : ''}`, points: 100 * diamonds });

  // Full chest: every die scores (part of a >=3 set, or a coin/diamond) and
  // there are no skulls in the eligible set. Needs the full 8 (or 9) dice.
  const scores = d => d.face === 'coin' || d.face === 'diamond' || counts[keyOf(d.face, card)] >= 3;
  const noSkulls = dice.every(d => d.face && d.face !== 'skull');
  if (dice.length >= 8 && noSkulls && dice.every(scores)) lines.push({ label: 'Full chest', points: 500 });

  return { lines, total: lines.reduce((s, l) => s + l.points, 0) };
}

export function scoreDice(dice, card) {
  return scoreBreakdown(dice, card).total;
}
