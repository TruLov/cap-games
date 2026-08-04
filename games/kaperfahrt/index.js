/**
 * Kaperfahrt — Platform game module.
 *
 * A pirate dice game (8 dice + a card deck, first to 6000 points), inspired by
 * the German dice game "Piraten Kapern" by Haim Shafir. Original name, rules
 * text and art — no assets from the published game are used.
 *
 * Implements the cap-games game interface:
 *   meta, settingsSchema, init(settings, players), applyMove(state, move, user),
 *   score(end, players)
 *
 * Pure logic — no CAP imports (per platform conventions). The turn engine lives
 * in ./flow.js; dice scoring in ./dice.js; the card deck in ./deck.js. Dice
 * rolls and card draws use Math.random inside applyMove (still synchronous and
 * CAP-free); flow.js accepts an injectable rng so tests can script exact rolls.
 *
 * All state is public (dice and cards are open information), so no
 * publicState/privateState projection is needed.
 */

import { init, applyMove, score } from './flow.js';

export default {

  meta: {
    name: 'Kaperfahrt',
    minPlayers: 2,
    maxPlayers: 5,
  },

  settingsSchema: {
    target: { type: 'number', default: 6000 },
  },

  init(settings = {}, players = []) {
    return init(settings, players);
  },

  applyMove(state, move, user) {
    return applyMove(state, move, user);
  },

  score(end, players) {
    return score(end, players);
  },
};
