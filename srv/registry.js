import cds from '@sap/cds';
const LOG = cds.log('games:registry');

/**
 * Game registry — populated from cds.env.games.
 *
 * Games register *declaratively* in their plugin package.json (CAP merges
 * every plugin's "cds" section into cds.env):
 *
 *   "cds": { "games": { "mygame": { "impl": "@cap-games/mygame", "ui": "ui" } } }
 *
 * loadAll() imports each impl once at `served` time. Programmatic
 * registration of a ready module object still works (legacy):
 *   (cds.env.games ??= {}).mygame = <game module>
 *
 * Interface contract:
 *   meta: { name, minPlayers, maxPlayers }
 *   settingsSchema: { [key]: { type, values?, default } }
 *   init(settings)                   → state
 *   applyMove(state, move, symbol)   → { state, end } | { error }
 *   score?(end, players)             → [{ user, result, points? }]
 *   extendService?(srv)              → void  (optional extra actions/events)
 *   publicState?/privateState?       → hidden-information projection
 */

const loaded = {};   // id → resolved game module

function get(id) { return loaded[id]; }
function all()   { return loaded; }

function validate(id, mod) {
  const required = ['meta', 'init', 'applyMove'];
  const missing = required.filter(k => !mod[k]);
  if (missing.length) throw new Error(`Game '${id}' missing: ${missing.join(', ')}`);
}

async function _resolve(entry) {
  if (typeof entry?.init === 'function') return entry;             // ready module object
  const spec = typeof entry === 'string' ? entry : entry?.impl;    // declarative reference
  if (!spec) throw new Error('neither a game module nor an impl reference');
  const mod = await import(spec);
  return mod.default ?? mod;
}

async function loadAll() {
  const games = cds.env.games ?? {};
  for (const [id, entry] of Object.entries(games)) {
    try {
      const mod = await _resolve(entry);
      validate(id, mod);
      loaded[id] = mod;
      LOG.info(`loaded game plugin: ${id} (${mod.meta?.name})`);
    } catch (e) {
      LOG.error(`invalid game plugin '${id}': ${e.message}`);
    }
  }
  return loaded;
}

export { get, all, loadAll };
