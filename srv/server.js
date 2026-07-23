/**
 * Custom server bootstrap — serves the UI of every registered game.
 *
 * Games are discovered by convention (see srv/registry.js discoverGames): every
 * `@cap-games/*` dependency is a game, its UI served from `<package>/app`
 * (override via a `cds.games.<id>.ui` entry) at /games/<id>. Game plugins need
 * no bootstrap code (and no express dependency) of their own. Legacy plugins
 * that mount their own statics in cds-plugin.js are unaffected.
 */
import cds from '@sap/cds';
import express from 'express';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { discoverGames } from './registry.js';

const require = createRequire(import.meta.url);
const LOG = cds.log('games:registry');

cds.on('bootstrap', app => {
  for (const [id, entry] of Object.entries(discoverGames())) {
    if (typeof entry?.init === 'function') continue;            // programmatic module: no static UI
    const impl = typeof entry === 'string' ? entry : (entry.impl ?? `@cap-games/${id}`);
    const ui = (typeof entry === 'object' && entry.ui) || 'app';
    try {
      const pkgDir = dirname(require.resolve(`${impl}/package.json`));
      app.use(`/games/${id}`, express.static(join(pkgDir, ui)));
      LOG.info(`serving UI for '${id}' from ${impl}/${ui}`);
    } catch (e) {
      LOG.error(`cannot mount UI for game '${id}': ${e.message}`);
    }
  }
});

export default cds.server;
