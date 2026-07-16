/**
 * Sushi Go Party! cds-plugin.js
 * Self-registers backend logic AND frontend UI serving.
 * No changes to platform needed.
 */
const cds     = require('@sap/cds');
const express = require('express');
const path    = require('path');

// Backend: register game logic
(cds.env.games ??= {}).sushigo = require('./game');

// Frontend: mount ui/ as /games/sushigo/
cds.on('bootstrap', app =>
  app.use('/games/sushigo', express.static(path.join(__dirname, 'ui'))));
