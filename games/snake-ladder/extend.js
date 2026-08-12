/**
 * Snake & Ladder - CAP-touching service extension.
 *
 * The pure reducer (./game.js) can't reach the DB; this is the documented
 * escape hatch (same role as games/mttt/extend.js) for the two things that need
 * CAP:
 *
 *   1. Load the board. The snakes/ladders live in this plugin's own
 *      `snakeladder.BoardSquares` table (CSV-seeded). We read it once at
 *      `served` - before any match can start - and hand it to the reducer via
 *      setBoard(), so the table stays the single source of truth for the board.
 *
 *   2. Persist move history. Every resolved move is appended to this plugin's
 *      own `snakeladder.TurnLog` table. The platform's `moved`/`finished` events
 *      carry the full game state JSON (see srv/play-service.js `_broadcastState`),
 *      so we log straight from the event without importing any platform module.
 *      Both events can fire more than once for the same turn (e.g. a snapshot
 *      resent to a re-joining client), so we dedupe on the monotonic turnNumber.
 *
 * ./cds-plugin.js composes this onto the pure ./game.js before registering.
 */

import cds from '@sap/cds';
import { setBoard } from './game.js';

const LOG = cds.log('snake-ladder');

export function extendService(srv) {
  // Load the board once, before gameplay. `served` has already fired by the
  // time extendService runs, so read immediately; it resolves long before any
  // WS match starts.
  (async () => {
    try {
      const rows = await SELECT.from('snakeladder.BoardSquares');
      setBoard(rows);
      LOG.info(`board loaded: ${rows.length} squares`);
    } catch (e) {
      LOG.error(`failed to load board: ${e.message}`);
    }
  })();

  // roomId → last turnNumber written, so a re-broadcast of the same turn (join
  // snapshot, reconnect) doesn't insert a duplicate TurnLog row.
  const logged = new Map();

  const logTurn = async (req) => {
    const roomId = req.data.room;
    const raw = req.data.state ?? req.data.data;
    if (!roomId || !raw) return;

    let state;
    try { state = JSON.parse(raw); } catch { return; }
    const m = state.lastMove;
    if (!m || !state.turnNumber) return;
    if ((logged.get(roomId) ?? 0) >= state.turnNumber) return;
    logged.set(roomId, state.turnNumber);

    await INSERT.into('snakeladder.TurnLog').entries({
      ID: cds.utils.uuid(),
      room: roomId,
      user: m.user,
      turnNumber: state.turnNumber,
      diceRoll: m.roll,
      fromSquare: m.from,
      toSquare: m.to,
      eventType: m.event,
      timestamp: new Date().toISOString(),
    });
  };

  srv.on('moved', logTurn);
  srv.on('finished', logTurn);
}
