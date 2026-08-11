/**
 * Kaperfahrt - pure game module (platform hook contract).
 *
 * A pirate dice game (8 dice + a card deck, first to 6000 points), inspired by
 * the German dice game "Piraten Kapern" by Haim Shafir. Original name, rules
 * text and art - no assets from the published game are used.
 *
 * Implements the cap-games hook contract: meta, settingsSchema, init, applyMove,
 * score. Pure logic - no CAP imports (so unit tests stay CAP-free). The turn
 * engine lives in ./flow.js; dice scoring in ./dice.js; the card deck in
 * ./deck.js. Registered with the platform by ./cds-plugin.js.
 *
 * All state is public (dice and cards are open information), so no
 * publicState/privateState projection is needed. No score() either: the
 * leaderboard result is plain win/draw/loss (3/1/0), which is exactly the
 * platform's defaultScore - so the game omits it and lets the platform apply
 * the default.
 */

import { init, applyMove } from './flow.js';

export default {

  meta: {
    name: 'Kaperfahrt',
    minPlayers: 2,
    maxPlayers: 5,
    help: 'A pirate-themed press-your-luck dice game for 2-5 players. Roll 8 dice and set aside scoring combinations each turn, re-rolling the rest - but three skull-and-crossbones dice sink your turn and you score nothing. Bank your points before that happens. First to reach the target score (6000 by default) wins.',
    gallery: ['gallery/cover-1.svg', 'gallery/cover-2.svg'],
  },

  settingsSchema: {
    target: { type: 'number', default: 6000 },
  },

  // Game-declared achievements - SINGLE-MATCH, pure (see checkAchievements).
  achievements: {
    pirateKing: { name: 'Pirate King', desc: 'Win by clearing the target by 1000+ points' },
  },

  checkAchievements(end, state, user) {
    const earned = [];
    if (end.winner === user && (end.scores?.[user] ?? 0) >= state.target + 1000) earned.push('pirateKing');
    return earned;
  },

  init(settings = {}, players = []) {
    return init(settings, players);
  },

  applyMove(state, move, user) {
    return applyMove(state, move, user);
  },
};
