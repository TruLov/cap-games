/**
 * Ultimate Tic-Tac-Toe — CAP-touching service extension.
 *
 * Registers this game's WS actions/events (see srv/extend.cds):
 *   - `chooseTeam`      self-service team picking (each player picks their own,
 *                       pre-start — the platform's own `configure` is host-only
 *                       and blindly overwrites Rooms.settings, so team picks
 *                       need their own merge-safe action)
 *   - `configureBlitz`  host-only per-move timer config, pre-start
 *   - `requestSettings` a client mounting the waiting room asks for the current
 *                       settings (the platform's WS actions are fire-and-forget)
 *   - the blitz per-move timer itself
 *
 * This is the documented exception to the pure-function game contract: it needs
 * DB access for the pre-start picks (same as srv/play-service.js). The blitz
 * timer additionally uses `getBoard` (handed in as the second arg — engine.js
 * lives outside every `@cap-games/*` package, so a relative import would break
 * once this package is packed for deploy) to mutate the shared board-state
 * reference in place. ./cds-plugin.js composes this onto the pure ./game.js
 * module before registering the game with the platform.
 */

import cds from '@sap/cds';
import { currentTurn, resolveBlitz, MIN_BLITZ_SECONDS, MAX_BLITZ_SECONDS } from './game.js';

export function extendService(srv, { getBoard }) {
  const { Rooms, Players } = cds.entities('cap.games');

  const loadSettings = async (roomId) => {
    const room = await SELECT.one.from(Rooms, roomId).columns('settings');
    return room?.settings ? JSON.parse(room.settings) : {};
  };

  const broadcastSettings = async (roomId, settings) => {
    const teams = { X: settings.teams?.X ?? [], O: settings.teams?.O ?? [] };
    const blitz = resolveBlitz(settings);
    await srv.emit('settingsChanged', {
      room: roomId, teams: JSON.stringify(teams),
      blitzEnabled: blitz.enabled, blitzSeconds: blitz.seconds,
    });
  };

  // CDS-native `req.error(...)` only delivers via an ack callback — this
  // platform's client (`sdk.send`/`wsSend`) never registers one, so it
  // would silently swallow every validation error. The platform's own
  // handlers surface errors via a `gameError` broadcast instead
  // (srv/play-service.js's `_error`); mirrored here for the same reason.
  const gameError = (roomId, message) => srv.emit('gameError', { room: roomId, message });

  srv.on('chooseTeam', async (req) => {
    const { room: roomId, team } = req.data;
    const user = req.user.id;
    if (!['X', 'O', 'none'].includes(team))
      return gameError(roomId, `Invalid team: ${team}`);

    const room = await SELECT.one.from(Rooms, roomId).columns('status', 'settings');
    if (!room) return gameError(roomId, 'room not found');
    if (room.status !== 'lobby') return gameError(roomId, 'teams are locked once the match starts');

    const player = await SELECT.one.from(Players).where({ room_ID: roomId, user });
    if (!player || player.spectator) return gameError(roomId, 'spectators cannot join a team');

    const settings = room.settings ? JSON.parse(room.settings) : {};
    const teams = { X: settings.teams?.X ?? [], O: settings.teams?.O ?? [] };
    teams.X = teams.X.filter(u => u !== user);
    teams.O = teams.O.filter(u => u !== user);
    if (team !== 'none') teams[team].push(user);

    const newSettings = { ...settings, teams };
    await UPDATE(Rooms, roomId).with({ settings: JSON.stringify(newSettings) });
    await broadcastSettings(roomId, newSettings);
  });

  srv.on('configureBlitz', async (req) => {
    const { room: roomId, enabled, seconds } = req.data;
    const user = req.user.id;
    if (typeof enabled !== 'boolean') return gameError(roomId, 'enabled must be a boolean');
    if (!Number.isInteger(seconds) || seconds < MIN_BLITZ_SECONDS || seconds > MAX_BLITZ_SECONDS)
      return gameError(roomId, `seconds must be between ${MIN_BLITZ_SECONDS} and ${MAX_BLITZ_SECONDS}`);

    const room = await SELECT.one.from(Rooms, roomId).columns('status', 'host', 'settings');
    if (!room) return gameError(roomId, 'room not found');
    if (room.host !== user) return gameError(roomId, 'host only');
    if (room.status !== 'lobby') return gameError(roomId, 'blitz settings are locked once the match starts');

    const settings = room.settings ? JSON.parse(room.settings) : {};
    const newSettings = { ...settings, blitz: { enabled, seconds } };
    await UPDATE(Rooms, roomId).with({ settings: JSON.stringify(newSettings) });
    await broadcastSettings(roomId, newSettings);
  });

  srv.on('requestSettings', async (req) => {
    const settings = await loadSettings(req.data.room);
    await broadcastSettings(req.data.room, settings);
  });

  // ---- blitz per-move timer ----------------------------------------
  // roomId -> Node timer handle. Module-scoped like srv/engine.js's own
  // graceTimers/boardState maps.
  const turnTimers = new Map();

  const clearTurnTimer = (roomId) => {
    clearTimeout(turnTimers.get(roomId));
    turnTimers.delete(roomId);
  };
  const armTurnTimer = (roomId, seconds) => {
    clearTurnTimer(roomId);
    turnTimers.set(roomId, setTimeout(() => onTimeout(roomId), seconds * 1000));
  };

  // Re-evaluate the timer for a room whenever its board progresses
  // (started/moved/rematched) — reused by real moves AND by onTimeout's
  // own skip, which re-broadcasts via the same 'moved' event, so a single
  // hook naturally re-arms the timer for whoever's turn it is next.
  const onProgress = (roomId) => {
    const b = getBoard(roomId);
    if (!b || b.game !== 'mttt') return; // this hook fires for EVERY game's events
    clearTurnTimer(roomId);
    if (b.state.winner || !b.state.blitz?.enabled) return;
    armTurnTimer(roomId, b.state.blitz.seconds);
  };

  async function onTimeout(roomId) {
    turnTimers.delete(roomId); // this handle already fired
    const b = getBoard(roomId);
    if (!b || b.game !== 'mttt' || b.state.winner || !b.state.blitz?.enabled) return;

    const room = await SELECT.one.from(Rooms, roomId).columns('status');
    if (!room || room.status !== 'playing') return; // paused/finished/reset since arming

    const timedOutUser = b.state.turn;
    const newMoveCount = b.state.moveCount + 1;
    const newState = { ...b.state, moveCount: newMoveCount, turn: currentTurn(b.state.teams, newMoveCount) };
    b.state = newState;
    b.turn = newState.turn;

    await srv._broadcastState(roomId, 'mttt', b, 'moved', {});
    await srv._sysMsg(roomId, `${timedOutUser} timed out — turn skipped.`);
    // no explicit re-arm here: the 'moved' broadcast above runs through
    // onProgress() below just like a real move would.
  }

  srv.on('started',   (req) => onProgress(req.data.room));
  srv.on('moved',     (req) => onProgress(req.data.room));
  srv.on('rematched', (req) => onProgress(req.data.room));
  srv.on('finished',   (req) => clearTurnTimer(req.data.room));
  srv.on('roomReset',  (req) => clearTurnTimer(req.data.room));
  srv.on('gameSwitched', (req) => clearTurnTimer(req.data.room));

  // Disconnect tolerance, consistent with the platform's own grace-timer
  // philosophy: don't let a dropped connection burn the mover's clock.
  srv.on('playerDisconnected', (req) => {
    const b = getBoard(req.data.room);
    if (b?.game === 'mttt' && b.state.turn === req.data.player) clearTurnTimer(req.data.room);
  });
  srv.on('playerReconnected', (req) => {
    const b = getBoard(req.data.room);
    if (b?.game === 'mttt' && b.state.turn === req.data.player && !b.state.winner && b.state.blitz?.enabled)
      armTurnTimer(req.data.room, b.state.blitz.seconds);
  });
}
