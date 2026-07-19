/**
 * Kaffee-Kwest — Platform game module.
 *
 * Implements the cap-games game interface:
 *   meta, settingsSchema, init(settings), applyMove(state, move, symbol),
 *   score(end, players), publicState(state), privateState(state, symbol)
 *
 * Pure logic — no CAP imports (per platform conventions). The engine lives
 * in ./lib/tree.js.
 *
 * ── Settings via prepare ───────────────────────────────────────────────────
 * The platform calls init(settings) without a roster (Kaiten precedent).
 * The host UI first calls KaffeeKwestService.prepare(scenario, party), which
 * returns the complete settings JSON (casting + frozen decision tree), sends
 * it via `configure`, then `start`. init() is trivial and pure after that.
 *
 * ── Hidden information ─────────────────────────────────────────────────────
 * The decision tree is never shown to players (concept rule). publicState()
 * strips the tree, the RNG seed and vote choices; clients only see the
 * current node's presentation (prose, option labels without target nodes,
 * roll target). privateState() adds the player's own casting hook.
 */

import * as tree from './lib/tree.js';

/** Presentation of the current node — no branch targets, no future nodes. */
function nodeView(state) {
  if (state.phase !== 'playing') return null;
  const n = state.tree.nodes[state.nodeId];
  const v = { mechanic: n.mechanic };
  if (n.mechanic === 'vote')   v.options = n.options.map(o => o.label);
  if (n.mechanic === 'roll')   v.roll = { symbol: n.roll.symbol, target: n.roll.target, bonus: n.roll.bonus ?? 0 };
  if (n.mechanic === 'moment') { v.actor = n.symbol; v.prompt = n.prompt ?? 'Was tust oder sagst du?'; }
  return v;
}

export default {

  meta: {
    name: 'Kaffee-Kwest',
    minPlayers: 2,
    maxPlayers: 6,
  },

  // All real settings come from KaffeeKwestService.prepare via `configure`.
  settingsSchema: {},

  init(settings = {}) {
    return tree.init(settings);
  },

  applyMove(state, move, symbol) {
    return tree.applyMove(state, move, symbol);
  },

  /**
   * Co-op: nobody loses against each other — everyone records a 'draw',
   * points reflect the quality of the reached ending.
   */
  score(end, players) {
    const points = { good: 3, mixed: 2, bad: 1 }[end.ending?.tier] ?? 1;
    return players
      .filter(p => p.symbol !== 'spectator')
      .map(p => ({ user: p.user, result: 'draw', points }));
  },

  /** Broadcast to the whole room — tree, seed and vote choices stay server-side. */
  publicState(state) {
    const { tree: _tree, seed: _seed, rngN: _rngN, casting, votes, ...rest } = state;
    return {
      ...rest,
      casting: Object.fromEntries(
        Object.entries(casting).map(([s, c]) => [s, { role: c.role }])),
      votes: Object.fromEntries(Object.keys(votes).map(s => [s, true])),
      node: nodeView(state),
    };
  },

  /** Per-player slice: adds the own role's narrative hook. */
  privateState(state, symbol) {
    const c = state.casting[symbol];
    return {
      ...this.publicState(state),
      me: c ? { role: c.role, hook: c.hook } : null,
    };
  },
};
