/**
 * Kaiten — Platform game module.
 *
 * Implements the cap-games game interface:
 *   meta, settingsSchema, init(settings), applyMove(state, move, symbol),
 *   score(end, players)
 *
 * Pure logic — no CAP imports (per platform conventions). The heavy lifting
 * lives in ./flow (turn engine) and ./scoring (card strategies).
 *
 * ── Roster in settings ─────────────────────────────────────────────────────
 * The platform calls init(settings) without a player roster. Kaiten needs the
 * roster to deal hands, so the host UI must include it in the room settings:
 *
 *   settings = {
 *     players: ['X','O',...],           // player symbols (from join events)
 *     preset:  'classic',              // OR a custom menu:
 *     roll, appetizers:[3], specials:[2], dessert
 *   }
 *
 * The host UI sends `configure` with this JSON before `start`.
 *
 * ── Hidden information ─────────────────────────────────────────────────────
 * The platform redacts state per recipient via the publicState/privateState
 * hooks: opponents only ever receive the public projection (played cards, hand
 * counts, scores), while each player receives their own hand through a
 * user-scoped `privateState` event.
 */

'use strict';

const flow = require('./flow');
const { MENUS } = require('./deck');

module.exports = {

  meta: {
    name: 'Kaiten',
    minPlayers: 2,
    // Platform currently provides 6 player symbols (X,O,A,B,C,D); 7–8 player
    // games require platform symbol expansion. Menu rules still validate 7–8p.
    maxPlayers: 6,
  },

  settingsSchema: {
    preset: {
      type: 'enum',
      values: [...Object.keys(MENUS), 'custom'],
      default: 'classic',
    },
  },

  init(settings = {}) {
    return flow.init(settings);
  },

  applyMove(state, move, symbol) {
    return flow.applyMove(state, move, symbol);
  },

  /**
   * Map the final ranking to leaderboard results.
   * @param end     { winner, ranking:[{symbol,score,desserts}] }
   * @param players DB players [{ user, symbol }]
   */
  score(end, players) {
    const ranking = end.ranking ?? [];
    if (ranking.length === 0) return [];

    const top = ranking[0];
    const winners = new Set(
      ranking.filter(r => r.score === top.score && r.desserts === top.desserts)
             .map(r => r.symbol));
    const sharedTop = winners.size > 1;
    const bySymbol = Object.fromEntries(ranking.map(r => [r.symbol, r]));

    return players
      .filter(p => p.symbol !== 'spectator' && bySymbol[p.symbol])
      .map(p => {
        const r = bySymbol[p.symbol];
        const result = winners.has(p.symbol) ? (sharedTop ? 'draw' : 'win') : 'loss';
        return { user: p.user, result, points: r.score };
      });
  },

  /**
   * Public projection broadcast to everyone in the room. Strips all hidden
   * information: hand contents, the draw pile, the dessert pool order, and the
   * identities of cards secretly selected this turn.
   */
  publicState(state) {
    const { hands, drawPile, dessertPool, pending, menuOffer, menuHold, ...rest } = state;
    return {
      ...rest,
      handCounts: Object.fromEntries(
        Object.entries(hands ?? {}).map(([s, h]) => [s, h.length])),
      selected: Object.fromEntries(
        (state.symbols ?? []).map(s => [s, Boolean(pending?.[s])])),
      pendingCount: Object.keys(pending ?? {}).length,
    };
  },

  /**
   * Private projection delivered only to `symbol`'s player: the public view
   * plus that player's own hand and any Menu cards currently offered to them.
   */
  privateState(state, symbol) {
    return {
      ...this.publicState(state),
      myHand: state.hands?.[symbol] ?? [],
      menuOffer: state.menuOffer?.[symbol],
    };
  },
};
