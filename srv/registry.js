import cds from '@sap/cds';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const LOG = cds.log('games:registry');
const require = createRequire(import.meta.url);
const GAME_SCOPE = '@cap-games/';

/**
 * Game registry — games are discovered by *convention*, with zero config:
 * every `@cap-games/*` dependency is a game, its id the name after the scope
 * (`@cap-games/kaiten` → `kaiten`), its UI served from `<pkg>/app`. Just add
 * the package to dependencies — no `cds.games` entry needed.
 *
 * `cds.env.games` still works to override or extend: a `{ impl?, ui? }` entry
 * (custom package/UI folder) or a ready module object for programmatic/test
 * registration ( (cds.env.games ??= {}).mygame = <module> ).
 *
 * Interface contract (the per-player token is the `user` id — the platform
 * assigns no game symbols; a game that wants marks derives them from `players`):
 *   meta: { name, minPlayers, maxPlayers }
 *   settingsSchema: { [key]: { type, values?, default } }
 *   init(settings, players)          → state   (players: ordered [{ user, isHost }])
 *   applyMove(state, move, user)     → { state, end } | { error }
 *   score?(end, players)             → [{ user, result, points? }]  (end.winner = user|'draw')
 *   extendService?(srv)              → void  (optional extra actions/events)
 *   publicState?/privateState?(state, user) → hidden-information projection
 */

const loaded = {};   // id → resolved game module

function get(id) { return loaded[id]; }
function all()   { return loaded; }

function validate(id, mod) {
  const required = ['meta', 'init', 'applyMove'];
  const missing = required.filter(k => !mod[k]);
  if (missing.length) throw new Error(`Game '${id}' missing: ${missing.join(', ')}`);
}

async function _resolve(id, entry) {
  if (typeof entry?.init === 'function') return entry;             // ready module object
  // declarative reference — package is `@cap-games/<id>` by convention
  const spec = typeof entry === 'string' ? entry : (entry?.impl ?? `${GAME_SCOPE}${id}`);
  const mod = await import(spec);
  return mod.default ?? mod;
}

/**
 * The set of games to serve: `@cap-games/*` dependencies (by convention),
 * with any explicit `cds.env.games` entries overriding/extending. Shared by
 * loadAll() (backend) and the UI bootstrap in srv/server.js.
 */
function discoverGames() {
  const games = {};
  try {
    const pkg = require(join(cds.root, 'package.json'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(deps))
      if (name.startsWith(GAME_SCOPE)) games[name.slice(GAME_SCOPE.length)] = { impl: name };
  } catch (e) {
    LOG.warn(`game discovery: cannot read root package.json: ${e.message}`);
  }
  return { ...games, ...(cds.env.games ?? {}) };   // explicit entries win
}

async function loadAll() {
  const games = discoverGames();
  for (const [id, entry] of Object.entries(games)) {
    try {
      const mod = await _resolve(id, entry);
      validate(id, mod);
      loaded[id] = mod;
      LOG.info(`loaded game plugin: ${id} (${mod.meta?.name})`);
    } catch (e) {
      LOG.error(`invalid game plugin '${id}': ${e.message}`);
    }
  }
  return loaded;
}

export { get, all, loadAll, discoverGames };
