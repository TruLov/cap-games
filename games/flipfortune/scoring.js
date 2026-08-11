/**
 * Flip Fortune - round scoring (pure, no CAP imports).
 *
 * Scoring order for a surviving line: sum the number cards → double it if the ×2
 * modifier is held → add the flat +N modifiers → add 15 for a Flip 7. A busted
 * line scores 0. `scoreRound` also returns an itemised `lines` breakdown that
 * drives the round-end summary overlay.
 */

import { MOD_VALUE } from './deck.js';

/**
 * @param line { cards, numbers:[int], status, secondChance, flip7 }
 * @returns { points, busted, lines:[{label, value?, mult?}] }
 */
export function scoreRound(line) {
  if (line.status === 'busted') return { points: 0, busted: true, lines: [] };

  const numbers = line.numbers ?? [];
  const numberSum = numbers.reduce((s, v) => s + v, 0);
  const hasX2 = line.cards.some(c => c.kind === 'modifier' && c.mod === 'x2');
  const flats = line.cards.filter(c => c.kind === 'modifier' && c.mod !== 'x2');

  const lines = [{ label: `Numbers (${numbers.length})`, value: numberSum }];
  if (hasX2) lines.push({ label: 'Double', mult: 2 });
  for (const c of flats) lines.push({ label: c.mod, value: MOD_VALUE[c.mod] });
  if (line.flip7) lines.push({ label: 'Flip 7 bonus', value: 15 });

  const flatSum = flats.reduce((s, c) => s + MOD_VALUE[c.mod], 0);
  const points = numberSum * (hasX2 ? 2 : 1) + flatSum + (line.flip7 ? 15 : 0);
  return { points, busted: false, lines };
}

/**
 * The winner once a round has ended, or null if the game continues. A player
 * wins only with a score that both reaches the target and is the sole highest -
 * a tie at the top (even above the target) plays another round.
 */
export function resolveWinner(scores, players, target) {
  let max = -Infinity;
  for (const u of players) max = Math.max(max, scores[u] ?? 0);
  if (max < target) return null;
  const leaders = players.filter(u => (scores[u] ?? 0) === max);
  return leaders.length === 1 ? leaders[0] : null;
}
