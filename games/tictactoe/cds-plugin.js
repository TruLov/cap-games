import cds from '@sap/cds';
import game from './game.js';

// Self-register with the platform. The @sap/cds facade is the only channel a
// game can reach in both dev and packed-deploy layouts (see srv/registry.js).
((cds.games ??= {}).tictactoe = { mod: game, dir: import.meta.url });
