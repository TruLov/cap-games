/**
 * Kaperfahrt — the card deck (pure, no CAP imports).
 *
 * Each turn the active player draws one card that shapes the round. Faithful to
 * the physical game's card types, with one deliberate simplification: cards are
 * drawn uniformly at random every turn rather than from a depleting/reshuffled
 * pile — a digital game has effectively unlimited turns and no visible deck.
 *
 * Card shapes:
 *   { type: 'sorceress' }                once per turn, reroll any dice incl. a skull
 *   { type: 'captain'   }                final turn score is doubled
 *   { type: 'seabattle', need, bonus }   collect >= `need` sabers → +bonus, else −bonus
 *   { type: 'chest'     }                dice moved into the chest survive a bust
 *   { type: 'coin'      }                start with a 9th die showing a coin
 *   { type: 'diamond'   }                start with a 9th die showing a diamond
 *   { type: 'animals'   }                monkeys + parrots count as one symbol
 *   { type: 'curse', skulls }            start the turn with `skulls` skulls set aside
 */

// Weighted deck composition (count of each card in the "bag").
export const DECK = [
  ...repeat(6, { type: 'sorceress' }),
  ...repeat(4, { type: 'captain' }),
  ...repeat(2, { type: 'seabattle', need: 2, bonus: 300 }),
  ...repeat(2, { type: 'seabattle', need: 3, bonus: 500 }),
  ...repeat(2, { type: 'seabattle', need: 4, bonus: 1000 }),
  ...repeat(2, { type: 'chest' }),
  ...repeat(4, { type: 'coin' }),
  ...repeat(4, { type: 'diamond' }),
  ...repeat(4, { type: 'animals' }),
  ...repeat(2, { type: 'curse', skulls: 1 }),
  ...repeat(2, { type: 'curse', skulls: 2 }),
];

function repeat(n, card) {
  return Array.from({ length: n }, () => ({ ...card }));
}

// Draw one card uniformly at random. `rng` returns a float in [0, 1).
export function drawCard(rng = Math.random) {
  const i = Math.min(DECK.length - 1, Math.floor(rng() * DECK.length));
  return { ...DECK[i] };
}
