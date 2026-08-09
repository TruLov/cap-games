import cds from '@sap/cds';
import game from './game.js';
import { extendService } from './extend.js';

// Self-register with the platform. The @sap/cds facade is the only channel a
// game can reach in both dev and packed-deploy layouts (see srv/registry.js).
// This game composes its pure reducer (game.js) with a CAP-touching extension
// (extend.js) that loads its own board table and logs its own TurnLog.
((cds.games ??= {})['snake-ladder'] = { mod: { ...game, extendService }, dir: import.meta.url });
