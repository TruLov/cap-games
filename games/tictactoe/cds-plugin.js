/**
 * TicTacToe cds-plugin.js
 * Auto-loaded by CAP runtime when package is installed.
 * Self-registers in cds.env.games — no changes to platform needed.
 */
const cds = require('@sap/cds');
(cds.env.games ??= {}).tictactoe = require('./game');
