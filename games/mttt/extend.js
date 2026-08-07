/**
 * Ultimate Tic-Tac-Toe — CAP-touching service extension.
 *
 * Registers this game's pre-start WS actions/events (see srv/extend.cds):
 *   - `chooseTeam`      self-service team picking (each player picks their own,
 *                       pre-start — the platform's own `configure` is host-only
 *                       and blindly overwrites Rooms.settings, so team picks
 *                       need their own merge-safe action)
 *   - `configureBlitz`  host-only per-move timer config, pre-start
 *   - `requestSettings` a client mounting the waiting room asks for the current
 *                       settings (the platform's WS actions are fire-and-forget)
 *
 * This is the documented exception to the pure-function game contract: it needs
 * DB access for the pre-start picks (same as srv/play-service.js). The blitz
 * timer itself is NOT here — it's a pure reducer (game.js's onTick), driven by
 * the platform's generic server-tick loop, so this extension no longer reaches
 * into engine.js's board state. ./cds-plugin.js composes this onto the pure
 * ./game.js module before registering the game with the platform.
 */

import cds from '@sap/cds';
import { resolveBlitz, MIN_BLITZ_SECONDS, MAX_BLITZ_SECONDS } from './game.js';

export function extendService(srv) {
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
}
