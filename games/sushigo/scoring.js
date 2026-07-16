/**
 * Sushi Go Party! — Scoring orchestrator.
 *
 * Runs the Strategy registry across all players:
 *   scoreRound(players, playerCount, state) -> { [symbol]: points }
 *   scoreGame (players, playerCount)        -> { [symbol]: points }   (desserts)
 *
 * Pure logic. No mutation of inputs.
 */

'use strict';

const { STRATEGIES, flippedCount } = require('./cards/strategies');

const ALL_TYPES = Object.keys(STRATEGIES);

/**
 * End-of-round scoring for every player.
 *
 * Restricting by the menu's card types is essential: e.g. Pudding's most/fewest
 * and Fruit's 0-icon penalty must NOT fire when those cards are not in the menu.
 *
 * @param roundTypes card types in play this round (defaults to all — for tests)
 */
function scoreRound(players, playerCount, state = {}, roundTypes = ALL_TYPES) {
  const ctx = { players, playerCount, state };
  const out = {};
  for (const p of players) {
    let pts = flippedCount(p) * 2; // Takeout Box: each flipped card worth 2
    for (const type of roundTypes) {
      const strat = STRATEGIES[type];
      if (strat?.scoreRound) pts += strat.scoreRound(p, ctx);
    }
    out[p.symbol] = pts;
  }
  return out;
}

/**
 * End-of-game dessert scoring for every player.
 * @param dessertType the single dessert type in the menu (defaults to all — for tests)
 */
function scoreGame(players, playerCount, dessertType = null) {
  const ctx = { players, playerCount };
  const types = dessertType ? [dessertType] : ['pudding', 'green_tea_ice_cream', 'fruit'];
  const out = {};
  for (const p of players) {
    let pts = 0;
    for (const type of types) {
      const strat = STRATEGIES[type];
      if (strat?.scoreGame) pts += strat.scoreGame(p, ctx);
    }
    out[p.symbol] = pts;
  }
  return out;
}

module.exports = { scoreRound, scoreGame };
