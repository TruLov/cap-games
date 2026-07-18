/**
 * Kaiten cds-plugin.js
 * Self-registers backend logic AND frontend UI serving.
 * No changes to platform needed.
 */
import cds from '@sap/cds';
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import game from './game.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Backend: register game logic
(cds.env.games ??= {}).kaiten = game;

// Frontend: mount ui/ as /games/kaiten/
cds.on('bootstrap', app =>
  app.use('/games/kaiten', express.static(join(__dirname, 'ui'))));
