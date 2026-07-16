/**
 * Sushi Go Party! — Card scoring strategies (Strategy pattern).
 *
 * Each card type maps to a strategy object. A strategy may implement:
 *   scoreRound(player, ctx) -> number   end-of-round points for this player
 *   scoreGame(player, ctx)  -> number   end-of-game points (desserts only)
 *
 * ctx = { players, playerCount, state }
 *
 * Player board shape (relevant fields):
 *   { symbol, played: Card[], desserts: Card[] }
 *   - `played`  : cards placed this round. A card may carry:
 *                 - onWasabi: true (Nigiri tripled)
 *                 - flipped:  true (Takeout Box → worth 2, loses identity)
 *   - `desserts`: dessert cards accumulated across all rounds
 *
 * Cross-player strategies (Maki, Temaki, Uramaki, Edamame, Soy Sauce, and the
 * desserts Pudding) read ctx.players to rank the calling player.
 *
 * Pure logic. No CAP imports, no mutation of inputs.
 */

'use strict';

const { NIGIRI_VALUES, ONIGIRI_SHAPES, FRUIT_TYPES } = require('./catalogue');

// --- helpers ---------------------------------------------------------------

/** Non-flipped played cards (flipped cards lost their identity). */
const active = (player) => player.played.filter(c => !c.flipped);

/** Count non-flipped played cards of a given type. */
const countType = (player, type) => active(player).filter(c => c.type === type).length;

/** Number of flipped (Takeout Box) cards. */
const flippedCount = (player) => player.played.filter(c => c.flipped).length;

/** Sum a numeric field over cards of a type. */
const sumIcons = (player, type) =>
  active(player).filter(c => c.type === type).reduce((s, c) => s + (c.icons ?? 0), 0);

const URAMAKI_POINTS = [8, 5, 2];

const DUMPLING_TABLE = { 0: 0, 1: 1, 2: 3, 3: 6, 4: 10, 5: 15 };
const ONIGIRI_TABLE  = { 0: 0, 1: 1, 2: 4, 3: 9, 4: 16 };
const FRUIT_TABLE    = { 0: -2, 1: 0, 2: 1, 3: 3, 4: 6 }; // 5+ = 10

/**
 * Award a "most" (and optionally "fewest") comparison across players.
 * Returns a map symbol -> points. Ties all receive the full points.
 */
function rankMost(players, valueOf, points) {
  const vals = players.map(p => valueOf(p));
  const max = Math.max(...vals);
  const out = {};
  players.forEach((p, i) => { out[p.symbol] = vals[i] === max && max > 0 ? points : 0; });
  return out;
}

// --- strategies ------------------------------------------------------------

const STRATEGIES = {

  // === Nigiri ===============================================================
  nigiri: {
    scoreRound(player) {
      return active(player)
        .filter(c => c.type === 'nigiri')
        .reduce((s, c) => s + c.value * (c.onWasabi ? 3 : 1), 0);
    },
  },

  // === Rolls ================================================================
  maki: {
    scoreRound(player, { players, playerCount }) {
      const tiers = playerCount >= 6 ? [6, 4, 2] : [6, 3];
      const iconsOf = p => sumIcons(p, 'maki');
      const mine = iconsOf(player);
      if (mine === 0) return 0;

      // distinct positive totals, high → low
      const distinct = [...new Set(players.map(iconsOf).filter(v => v > 0))]
        .sort((a, b) => b - a);
      const place = distinct.indexOf(mine);
      return place >= 0 && place < tiers.length ? tiers[place] : 0;
    },
  },

  temaki: {
    scoreRound(player, { players, playerCount }) {
      const countOf = p => countType(p, 'temaki');
      const counts = players.map(countOf);
      const max = Math.max(...counts);
      const min = Math.min(...counts);
      const mine = countOf(player);

      let pts = 0;
      if (mine === max && max > 0) pts += 4;
      // fewest loses 4 — but not in a 2-player game, and only if there's a spread
      if (playerCount > 2 && mine === min && min < max) pts -= 4;
      return pts;
    },
  },

  uramaki: {
    scoreRound(player, { players, state }) {
      const placeIndex = state?.uramakiPlaceIndex ?? 0;
      if (placeIndex >= URAMAKI_POINTS.length) return 0;
      const iconsOf = p => sumIcons(p, 'uramaki');
      const mine = iconsOf(player);
      if (mine === 0) return 0;
      const max = Math.max(...players.map(iconsOf));
      return mine === max ? URAMAKI_POINTS[placeIndex] : 0;
    },
  },

  // === Appetizers ===========================================================
  tempura: {
    scoreRound: (p) => Math.floor(countType(p, 'tempura') / 2) * 5,
  },

  sashimi: {
    scoreRound: (p) => Math.floor(countType(p, 'sashimi') / 3) * 10,
  },

  dumpling: {
    scoreRound: (p) => DUMPLING_TABLE[Math.min(countType(p, 'dumpling'), 5)],
  },

  eel: {
    scoreRound(p) {
      const n = countType(p, 'eel');
      return n === 0 ? 0 : n === 1 ? -3 : 7;
    },
  },

  tofu: {
    scoreRound(p) {
      const n = countType(p, 'tofu');
      return n === 1 ? 2 : n === 2 ? 6 : 0;
    },
  },

  onigiri: {
    scoreRound(p) {
      const counts = {};
      for (const shape of ONIGIRI_SHAPES) counts[shape] = 0;
      for (const c of active(p)) if (c.type === 'onigiri') counts[c.shape]++;
      let score = 0;
      // greedily form sets; each set scores by number of distinct shapes in it
      for (;;) {
        const distinct = ONIGIRI_SHAPES.filter(s => counts[s] > 0);
        if (distinct.length === 0) break;
        score += ONIGIRI_TABLE[distinct.length];
        for (const s of distinct) counts[s]--;
      }
      return score;
    },
  },

  edamame: {
    scoreRound(player, { players }) {
      const mine = countType(player, 'edamame');
      if (mine === 0) return 0;
      const opponentsWith = players.filter(
        p => p.symbol !== player.symbol && countType(p, 'edamame') > 0).length;
      return mine * Math.min(4, opponentsWith);
    },
  },

  miso: {
    // Same-turn duplicate Miso Soups are discarded by the engine, so any
    // survivors in `played` each score 3.
    scoreRound: (p) => countType(p, 'miso') * 3,
  },

  // === Specials =============================================================
  wasabi:      { scoreRound: () => 0 }, // value flows into the Nigiri on top
  chopsticks:  { scoreRound: () => 0 },
  spoon:       { scoreRound: () => 0 },
  menu:        { scoreRound: () => 0 },
  takeout_box: { scoreRound: () => 0 }, // flipped cards handled by orchestrator
  // special_order is replaced by a copy of its target at play time → no strategy

  soy_sauce: {
    scoreRound(player, { players }) {
      const soy = countType(player, 'soy_sauce');
      if (soy === 0) return 0;
      const colorsOf = p => new Set(active(p).map(c => c.color)).size;
      const mine = colorsOf(player);
      const max = Math.max(...players.map(colorsOf));
      return mine === max ? soy * 4 : 0;
    },
  },

  tea: {
    scoreRound(player) {
      const tea = countType(player, 'tea');
      if (tea === 0) return 0;
      const byColor = {};
      for (const c of active(player)) byColor[c.color] = (byColor[c.color] ?? 0) + 1;
      const largest = Math.max(0, ...Object.values(byColor));
      return tea * largest;
    },
  },

  // === Desserts (scored at end of game) =====================================
  pudding: {
    scoreGame(player, { players, playerCount }) {
      const countOf = p => p.desserts.filter(c => c.type === 'pudding').length;
      const counts = players.map(countOf);
      const max = Math.max(...counts);
      const min = Math.min(...counts);
      const mine = countOf(player);
      let pts = 0;
      if (mine === max) pts += 6;
      if (playerCount > 2 && mine === min && min < max) pts -= 6;
      return pts;
    },
  },

  green_tea_ice_cream: {
    scoreGame(player) {
      const n = player.desserts.filter(c => c.type === 'green_tea_ice_cream').length;
      return Math.floor(n / 4) * 12;
    },
  },

  fruit: {
    scoreGame(player) {
      const icons = { watermelon: 0, orange: 0, pineapple: 0 };
      for (const c of player.desserts) {
        if (c.type !== 'fruit') continue;
        for (const f of c.fruits) icons[f]++;
      }
      return FRUIT_TYPES.reduce(
        (s, f) => s + (icons[f] >= 5 ? 10 : FRUIT_TABLE[icons[f]]), 0);
    },
  },
};

module.exports = { STRATEGIES, URAMAKI_POINTS, active, countType, flippedCount, sumIcons };
