/**
 * Custom server bootstrap — serves the UI of every registered game.
 *
 * Games self-register onto cds.games via their cds-plugin.js (see
 * srv/registry.js). Each registration carries the game package's cds-plugin.js
 * URL (`dir`), from which we serve its `app/` folder at /games/<id>. Game
 * plugins need no bootstrap code (and no express dependency) of their own.
 */
import cds from '@sap/cds';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { entry, ids } from './registry.js';

const LOG = cds.log('games:registry');

cds.on('bootstrap', app => {
  // By bootstrap, cds.plugins has resolved, so every game is registered.
  for (const id of ids()) {
    const { dir } = entry(id);
    try {
      const root = dirname(fileURLToPath(dir));   // game package root
      app.use(`/games/${id}`, express.static(join(root, 'app')));
      LOG.info(`serving UI for '${id}' from ${root}/app`);
    } catch (e) {
      LOG.error(`cannot mount UI for game '${id}': ${e.message}`);
    }
  }
});

export default cds.server;
