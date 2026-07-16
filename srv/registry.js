const cds = require('@sap/cds');
const LOG = cds.log('games:registry');

/**
 * Game registry — populated by game plugin packages via cds-plugin.js.
 * Each game registers: (cds.env.games ??= {}).mygame = require('./game')
 *
 * Interface contract:
 *   meta: { name, minPlayers, maxPlayers }
 *   settingsSchema: { [key]: { type, values?, default } }
 *   init(settings)                   → state
 *   applyMove(state, move, symbol)   → { state, end } | { error }
 *   score?(end, players)             → [{ user, result, points? }]
 *   extendService?(srv)              → void  (optional extra actions/events)
 */

function get(id) {
  const games = cds.env.games ?? {};
  return games[id];
}

function all() {
  return cds.env.games ?? {};
}

function validate(id, mod) {
  const required = ['meta', 'init', 'applyMove'];
  const missing = required.filter(k => !mod[k]);
  if (missing.length) throw new Error(`Game '${id}' missing: ${missing.join(', ')}`);
}

function loadAll() {
  const games = cds.env.games ?? {};
  for (const [id, mod] of Object.entries(games)) {
    try {
      validate(id, mod);
      LOG.info(`loaded game plugin: ${id} (${mod.meta?.name})`);
    } catch (e) {
      LOG.error(`invalid game plugin '${id}': ${e.message}`);
      delete games[id];
    }
  }
  return games;
}

module.exports = { get, all, loadAll };
