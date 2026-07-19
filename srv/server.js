/**
 * Custom server bootstrap — serves the UI of declaratively registered games.
 *
 * Game plugins declare themselves in their package.json:
 *   "cds": { "games": { "<id>": { "impl": "<package>" } } }
 * The platform mounts <package>/app (override via "ui" key) at /games/<id>,
 * so game plugins need no bootstrap code (and no express dependency) of
 * their own. Legacy plugins that mount their own statics in cds-plugin.js
 * are unaffected.
 */
import cds from '@sap/cds';
import express from 'express';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const LOG = cds.log('games:registry');

cds.on('bootstrap', app => {
  for (const [id, entry] of Object.entries(cds.env.games ?? {})) {
    if (!entry?.impl) continue;
    const ui = entry.ui ?? 'app';
    try {
      const pkgDir = dirname(require.resolve(`${entry.impl}/package.json`));
      app.use(`/games/${id}`, express.static(join(pkgDir, ui)));
      LOG.info(`serving UI for '${id}' from ${entry.impl}/${ui}`);
    } catch (e) {
      LOG.error(`cannot mount UI for game '${id}': ${e.message}`);
    }
  }
});

export default cds.server;
