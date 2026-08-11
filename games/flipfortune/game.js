/**
 * Flip Fortune - pure game module (platform hook contract).
 *
 * Implements meta, settingsSchema, init, applyMove, score plus
 * publicState/privateState to hide the draw pile. Pure logic - no CAP imports
 * (so unit tests stay CAP-free); the turn engine lives in ./flow and scoring in
 * ./scoring. Registered with the platform by ./cds-plugin.js. Players are
 * identified by their `user` id (the platform assigns no symbols).
 *
 * Hidden information here is only the *order of the draw pile* - every played
 * card is face-up and public. So the redaction hooks strip drawPile/discardPile
 * (exposing just their counts) and privateState is identical to publicState for
 * everyone; there are no per-player secrets.
 */

import { init, applyMove } from './flow.js';

export default {
  meta: {
    name: 'Flip Fortune', minPlayers: 2, maxPlayers: 8,
    help: 'A press-your-luck card game for 2-8 players. Flip cards from a shared deck to build up your turn score, but bust cards can wipe it out - decide each turn whether to keep flipping or bank your points before it is too late. First to reach the target score (100/200/300, configurable) wins.',
    gallery: ['gallery/cover-1.svg', 'gallery/cover-2.svg'],
  },

  settingsSchema: {
    target: { type: 'enum', values: [100, 200, 300], default: 200 },
  },

  // Game-declared achievements - SINGLE-MATCH, pure (see checkAchievements).
  achievements: {
    flipSeven:  { name: 'Flip Seven',  desc: 'Hit a Flip 7 in the winning round' },
    highRoller: { name: 'High Roller', desc: 'Win by clearing the target by 50+ points' },
  },

  // state.roundSummary is the FINAL round's per-player breakdown (see flow.js);
  // flip7 marks whether that player hit a Flip 7 that round.
  checkAchievements(end, state, user) {
    const earned = [];
    const mine = (state.roundSummary ?? []).find(s => s.user === user);
    if (mine?.flip7) earned.push('flipSeven');
    if (end.winner === user && (end.scores?.[user] ?? 0) >= state.target + 50) earned.push('highRoller');
    return earned;
  },

  init(settings = {}, players = []) {
    return init(settings, players);
  },

  applyMove(state, move, user) {
    return applyMove(state, move, user);
  },

  // No score(): reuse the platform's defaultScore win/loss mapping and just
  // supply the real per-player points (the running tally), so the W/D/L logic
  // lives in one place. end.winner is always a single user here.
  pointsOf(end, user) {
    return end.scores?.[user] ?? 0;
  },

  // Broadcast to the whole room: everything except the hidden pile order.
  publicState(state) {
    const { drawPile, discardPile, ...rest } = state;
    return { ...rest, drawCount: drawPile.length, discardCount: discardPile.length };
  },

  // No per-player secrets - each player's private slice is just the public view.
  privateState(state) {
    return this.publicState(state);
  },
};
