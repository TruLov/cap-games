import cds from '@sap/cds';

/**
 * Game registry - games self-register as CAP plugins.
 *
 * Every `@cap-games/*` package ships a `cds-plugin.js`, which CAP's plugin
 * loader auto-executes during `cds.plugins` (before serving). That file is the
 * game's hook into the platform: it imports the game's pure module and writes
 * it onto `cds.games` (the `@sap/cds` facade is the ONE thing every package can
 * reach in both dev and packed-deploy layouts - a game cannot import platform
 * files relatively once packed, so it touches the platform only through `cds`).
 * No root-package scanning, no `main` entry, no config.
 *
 *   // games/<id>/cds-plugin.js
 *   import cds from '@sap/cds';
 *   import game from './game.js';
 *   ((cds.games ??= {}).<id> = { mod: game, dir: import.meta.url });
 *
 * `cds.games` is a plain object keyed by game id → `{ mod, dir }`, where `dir`
 * is the game package's `cds-plugin.js` URL (used by srv/server.js to serve its
 * `app/` UI). Tests can register programmatically the same way:
 *   ((cds.games ??= {}).mygame = { mod });
 *
 * Interface contract (the per-player token is the `user` id - the platform
 * assigns no game symbols; a game that wants marks derives them from `players`):
 *   meta: { name, minPlayers, maxPlayers }
 *   settingsSchema?: { [key]: { type, values?, default } }
 *   init(settings, players)          → state   (players: ordered [{ user, isHost }])
 *   applyMove(state, move, user)     → { state, end } | { error }
 *   score?(end, players)             → [{ user, result, points? }]  (end.winner = user|'draw')
 *   pointsOf?(end, user)             → number  (ignored if score() is given;
 *     lets a game keep the platform's default W/D/L result mapping while
 *     attaching its own points instead of hand-rolling a full score())
 *   publicState?/privateState?(state, user) → hidden-information projection
 *   onTick?(state, elapsedMs)        → { state, end?, sys? } | null  (server-
 *     driven turn; requires meta.tick = { everyMs }. The platform calls it on
 *     an interval while the match is playing, passing how long the current turn
 *     has run, and broadcasts any returned state like a real move - so a timed
 *     game stays a pure reducer instead of reaching into engine.js)
 *   extendService?(srv)              → void  (optional extra WS actions/events)
 */

const reg = () => (cds.games ??= {});

function get(id)   { return reg()[id]?.mod; }
function entry(id) { return reg()[id]; }
function all()     { return Object.fromEntries(Object.entries(reg()).map(([k, v]) => [k, v.mod])); }
function ids()     { return Object.keys(reg()); }

function validate(id, mod) {
  const required = ['meta', 'init', 'applyMove'];
  const missing = required.filter(k => !mod?.[k]);
  if (missing.length) throw new Error(`Game '${id}' missing: ${missing.join(', ')}`);
}

export { get, entry, all, ids, validate };
