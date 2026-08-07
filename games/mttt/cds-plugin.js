import cds from '@sap/cds';
import game from './game.js';
import { extendService } from './extend.js';

// Self-register with the platform. The @sap/cds facade is the only channel a
// game can reach in both dev and packed-deploy layouts (see srv/registry.js).
// The pure reducer (game.js) is composed with the CAP-touching service
// extension (extend.js: pre-start team/blitz actions + the blitz timer).
((cds.games ??= {}).mttt = { mod: { ...game, extendService }, dir: import.meta.url });
