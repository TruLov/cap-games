/**
 * Kaiten — pure game module (platform hook contract).
 *
 * Implements meta, settingsSchema, init, applyMove, score plus
 * publicState/privateState for hidden hands. Pure logic — no CAP imports (so
 * unit tests stay CAP-free). The heavy lifting lives in ./flow (turn engine)
 * and ./scoring (card strategies). Registered with the platform by
 * ./cds-plugin.js. Players are identified by their `user` id (the platform
 * assigns no symbols); internally the flow/scoring code treats those ids as
 * opaque per-player tokens.
 *
 * ── Roster ─────────────────────────────────────────────────────────────────
 * The platform hands init() the ordered player roster, which kaiten needs to
 * deal hands. The menu comes from room settings:
 *
 *   settings = {
 *     preset: 'classic',               // OR a custom menu:
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

import * as flow from './flow.js';
import { MENUS } from './deck.js';

export default {

  meta: {
    name: 'Kaiten',
    minPlayers: 2,
    // Menu rules are defined for up to 8 players; kept at 6 until 7-8p is
    // play-tested. No longer capped by the platform (which used to hand out a
    // fixed set of symbols) — players are keyed by `user`.
    maxPlayers: 6,
  },

  settingsSchema: {
    preset: {
      type: 'enum',
      values: [...Object.keys(MENUS), 'custom'],
      default: 'classic',
    },
  },

  // players: ordered roster [{ user, isHost }] from the platform; flow keys on
  // the user ids as opaque tokens. (Falls back to settings.players for tests.)
  init(settings = {}, players = []) {
    const ids = players.length ? players.map(p => p.user) : (settings.players ?? []);
    return flow.init({ ...settings, players: ids });
  },

  applyMove(state, move, user) {
    return flow.applyMove(state, move, user);
  },

  /**
   * Map the final ranking to leaderboard results.
   * @param end     { winner, ranking:[{ symbol, score, desserts }] } — `symbol`
   *                is the per-player token, i.e. the user id
   * @param players DB players [{ user, spectator }]
   */
  score(end, players) {
    const ranking = end.ranking ?? [];
    if (ranking.length === 0) return [];

    const top = ranking[0];
    const winners = new Set(
      ranking.filter(r => r.score === top.score && r.desserts === top.desserts)
             .map(r => r.symbol));
    const sharedTop = winners.size > 1;
    const byUser = Object.fromEntries(ranking.map(r => [r.symbol, r]));

    return players
      .filter(p => !p.spectator && byUser[p.user])
      .map(p => {
        const r = byUser[p.user];
        const result = winners.has(p.user) ? (sharedTop ? 'draw' : 'win') : 'loss';
        return { user: p.user, result, points: r.score };
      });
  },

  /**
   * Public projection broadcast to everyone in the room. Strips all hidden
   * information: hand contents, the draw pile, the dessert pool order, and the
   * identities of cards secretly selected this turn.
   */
  publicState(state) {
    const { hands, drawPile: _drawPile, dessertPool: _dessertPool, pending, menuOffer: _menuOffer, menuHold: _menuHold, ...rest } = state;
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
   * Private projection delivered only to `user`'s player: the public view
   * plus that player's own hand and any Menu cards currently offered to them.
   */
  privateState(state, user) {
    return {
      ...this.publicState(state),
      myHand: state.hands?.[user] ?? [],
      menuOffer: state.menuOffer?.[user],
    };
  },
};
