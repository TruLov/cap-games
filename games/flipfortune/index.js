/**
 * Flip Fortune — Platform game module.
 *
 * Implements the cap-games game interface (meta, settingsSchema, init, applyMove,
 * score) plus publicState/privateState to hide the draw pile. Pure logic — no CAP
 * imports; the turn engine lives in ./flow and scoring in ./scoring. Players are
 * identified by their `user` id (the platform assigns no symbols).
 *
 * Hidden information here is only the *order of the draw pile* — every played
 * card is face-up and public. So the redaction hooks strip drawPile/discardPile
 * (exposing just their counts) and privateState is identical to publicState for
 * everyone; there are no per-player secrets.
 */

import { init, applyMove, score } from './flow.js';

export default {
  meta: { name: 'Flip Fortune', minPlayers: 2, maxPlayers: 8 },

  settingsSchema: {
    target: { type: 'enum', values: [100, 200, 300], default: 200 },
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

  // Broadcast to the whole room: everything except the hidden pile order.
  publicState(state) {
    const { drawPile, discardPile, ...rest } = state;
    return { ...rest, drawCount: drawPile.length, discardCount: discardPile.length };
  },

  // No per-player secrets — each player's private slice is just the public view.
  privateState(state) {
    return this.publicState(state);
  },
};
