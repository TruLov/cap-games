const cds     = require('@sap/cds');
const express = require('express');
const path    = require('path');

// Mount games/*/ui as /games/<name>/ for dynamic board module imports
cds.on('bootstrap', app => {
  const dirs = cds.utils.fs.globSync('games/*/ui');
  for (const dir of dirs) {
    const name = path.basename(path.dirname(dir));
    app.use(`/games/${name}`, express.static(dir));
  }
});

module.exports = cds.server;
