import cds from '@sap/cds';
import * as reg from './registry.js';

/**
 * Platform-wide (meta) achievements — the CROSS-GAME, aggregate tier.
 *
 * Purity split (mirrors score/applyMove):
 *   - Single-match, stateless feats live in each game's PURE module
 *     (`game.achievements` + `game.checkAchievements(end, state, user)`).
 *   - Anything aggregate — totals, streaks, "played them all" — is inherently
 *     stateful and lives HERE, evaluated with DB access against the same
 *     Leaderboard the platform already maintains.
 *
 * A user gets a Leaderboard row for (user, game) the moment they FINISH a match
 * in that game (win/loss/draw all score), so Leaderboard doubles as the
 * "has played" signal — no extra tracking needed.
 */
const META = {
  firstWin: { name: 'First Blood', desc: 'Win your first match' },
  allGames: { name: 'Sampler',     desc: 'Play every game at least once' },
};

// Evaluate meta achievements the user just earned in a finished match. Runs
// inside the play-service transaction, AFTER the Leaderboard row for this match
// has been upserted — so the aggregates already include the match at hand.
async function evaluateMeta({ user, end }) {
  const { Leaderboard } = cds.entities('cap.games');
  const earned = [];

  // One row per game the user has ever finished (key is user+game).
  const rows = await SELECT.from(Leaderboard).columns('game', 'wins').where({ user });

  const totalWins = rows.reduce((n, r) => n + (r.wins ?? 0), 0);
  if (end.winner === user && totalWins === 1) earned.push('firstWin');

  if (rows.length === reg.ids().length) earned.push('allGames');

  return earned;
}

// Resolve an achievement id to its display { name, desc }. gameId '' → meta;
// otherwise look it up on the game's pure module. Unknown ids degrade to the id.
function label(gameId, id) {
  const def = gameId ? reg.get(gameId)?.achievements?.[id] : META[id];
  return def ? { name: def.name, desc: def.desc } : { name: id, desc: '' };
}

// Full definition catalogue, keyed by game ('' = platform meta), each
// { name, defs: { id: { name, desc } } }. Only games that actually declare
// achievements appear. This is the SERVER's view — a user is never shown the
// locked `defs`; the browse endpoint uses it only to count totals and to label
// the unlocks a user already owns.
function catalogue() {
  const cat = { '': { name: 'Platform', defs: META } };
  for (const id of reg.ids()) {
    const g = reg.get(id);
    if (g?.achievements && Object.keys(g.achievements).length)
      cat[id] = { name: g.meta.name, defs: g.achievements };
  }
  return cat;
}

export { META, evaluateMeta, label, catalogue };
