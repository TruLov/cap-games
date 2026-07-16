/**
 * Sushi Go Party! — Platform game module.
 *
 * Implements the cap-games game interface:
 *   meta, settingsSchema, init(settings), applyMove(state, move, symbol),
 *   score(end, players)
 *
 * Pure logic — no CAP imports (per platform conventions). The heavy lifting
 * lives in ./flow (turn engine) and ./scoring (card strategies).
 *
 * ── Roster in settings ─────────────────────────────────────────────────────
 * The platform calls init(settings) without a player roster. Sushi Go needs the
 * roster to deal hands, so the host UI must include it in the room settings:
 *
 *   settings = {
 *     players: ['X','O',...],           // player symbols (from join events)
 *     preset:  'sushi_go',              // OR a custom menu:
 *     roll, appetizers:[3], specials:[2], dessert
 *   }
 *
 * The host UI sends `configure` with this JSON before `start`.
 *
 * ── Hidden information ─────────────────────────────────────────────────────
 * The platform broadcasts full state via the `moved`/`started` events. Use
 * `view(state, symbol)` on the client to render only the current player's hand.
 * (True server-side redaction would require platform support; see plan.)
 */

'use strict';

const flow = require('./flow');
const { MENUS } = require('./deck');

module.exports = {

  meta: {
    name: 'Sushi Go Party!',
    minPlayers: 2,
    // Platform currently provides 6 player symbols (X,O,A,B,C,D); 7–8 player
    // games require platform symbol expansion. Menu rules still validate 7–8p.
    maxPlayers: 6,
  },

  settingsSchema: {
    preset: {
      type: 'enum',
      values: [...Object.keys(MENUS), 'custom'],
      default: 'sushi_go',
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
   * Client-side view projection — returns a copy of `state` exposing only the
   * given player's hand (other hands are reduced to their card counts).
   */
  view(state, symbol) {
    const handCounts = Object.fromEntries(
      Object.entries(state.hands ?? {}).map(([s, h]) => [s, h.length]));
    return {
      ...state,
      hands: undefined,
      handCounts,
      myHand: state.hands?.[symbol] ?? [],
      hasSelected: Boolean(state.pending?.[symbol]),
      pendingCount: Object.keys(state.pending ?? {}).length,
    };
  },
};
