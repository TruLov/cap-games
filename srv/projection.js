import * as eng from './engine.js';
import * as reg from './registry.js';

/**
 * Hidden-information projection: redacts a game's board state per recipient
 * when the game opts in (publicState()/privateState()), and owns the wire
 * detail of which field a given event carries its payload in - `state` for
 * started/finished/rematched, `data` for moved/privateState (see
 * srv/play-service.cds's event declarations). Callers never construct that
 * split themselves; they pass a board + event name and get the right emit.
 *
 * `srv` only needs `.emit()` - broadcastState()/snapshotTo() are plain
 * functions, not service extensions.
 */

const hasProjection = g => typeof g.publicState === 'function' && typeof g.privateState === 'function';

// Player identity is the `user`; spectators only ever see the public view.
const sliceFor = (game, state, user, isSpectator, pub) =>
  isSpectator ? pub : JSON.stringify(game.privateState(state, user));

/**
 * Broadcast game state, redacting hidden information when the game opts in.
 *
 * If the game defines publicState()/privateState(), the room-scoped event
 * carries only the public projection, and each player additionally receives a
 * `privateState` event (delivered to that user only) with their private slice.
 * Otherwise the full state is broadcast (unchanged legacy behaviour).
 *
 * @param extra event-specific public fields, e.g. { firstTurn } or { winner }
 */
async function broadcastState(srv, { roomId, gameId, board, event, extra = {} }) {
  const game = reg.get(gameId);
  if (!hasProjection(game)) {
    const full = JSON.stringify(board.state);
    await srv.emit(event, { room: roomId, ...extra, state: full, data: full });
    return;
  }

  const pub = JSON.stringify(game.publicState(board.state));
  await srv.emit(event, { room: roomId, ...extra, state: pub, data: pub });

  const players = await SELECT.from('cap.games.Players').where({ room_ID: roomId });
  for (const p of players) {
    const slice = sliceFor(game, board.state, p.user, p.spectator, pub);
    await srv.emit('privateState', { room: roomId, data: slice }, { user: { include: [p.user] } });
  }
}

/**
 * Send the current state snapshot to a single (re)joining user: their private
 * slice plus the public table, so they can render immediately. No-op if the
 * game has no active board or does not use projection.
 */
async function snapshotTo(srv, { roomId, gameId, user, isSpectator }) {
  const b = eng.getBoard(roomId);
  if (!b) return;
  const game = reg.get(gameId);
  if (!hasProjection(game)) {
    // legacy games: resend full state to this user only
    const full = JSON.stringify(b.state);
    await srv.emit('moved', { room: roomId, data: full }, { user: { include: [user] } });
    return;
  }
  const pub = JSON.stringify(game.publicState(b.state));
  await srv.emit('privateState', { room: roomId, data: sliceFor(game, b.state, user, isSpectator, pub) }, { user: { include: [user] } });
  await srv.emit('moved', { room: roomId, data: pub }, { user: { include: [user] } });
}

export { broadcastState, snapshotTo };
