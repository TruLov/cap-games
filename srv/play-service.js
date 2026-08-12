import cds from '@sap/cds';
import * as eng from './engine.js';
import * as reg from './registry.js';
import * as ach from './achievements.js';

const LOG  = cds.log('game');

const _hasProjection = g => typeof g.publicState === 'function' && typeof g.privateState === 'function';
// Player identity is the `user`; spectators only ever see the public view.
const _sliceFor = (game, state, user, isSpectator, pub) =>
  isSpectator ? pub : JSON.stringify(game.privateState(state, user));

class PlayService extends cds.ApplicationService {

  async init() {
    // Access entities via namespace (cross-package service)
    const { Rooms, Players } = cds.entities('cap.games');

    // ------------------------------------------------------------------ join
    this.on('join', async (req) => {
      const { room: roomId } = req.data;
      const user = req.user.id;

      const room = await SELECT.one.from(Rooms).where({ ID: roomId })
        .columns('ID','game','host','status','settings');
      if (!room) return this._error(req, roomId, 'room not found');

      // An empty room (game === '') is valid — the host picks a game later via
      // switchGame. Only a *specified but unknown* game is an error.
      const game = room.game ? reg.get(room.game) : null;
      if (room.game && !game) return this._error(req, roomId, `unknown game: ${room.game}`);

      await req.context.ws.service.enter(roomId);

      // -- reconnect: had grace timer running
      if (eng.hasGraceTimer(roomId, user)) {
        eng.clearGraceTimer(roomId, user);
        // If the disconnect announcement was still pending (i.e. this is a
        // quick refresh), it never went out - so stay silent on reconnect too.
        const announced = !eng.clearAnnounceTimer(roomId, user);
        const player = await SELECT.one.from(Players)
          .where({ room_ID: roomId, user });
        if (room.status === 'paused') {
          await UPDATE(Rooms, roomId).with({ status: 'playing' });
        }
        // 'joined' is what the reconnecting client itself waits on to (re)build
        // its room UI (app/platform.js's onFirstJoin) — 'playerReconnected' alone
        // only reaches OTHER clients already in the room, never this one.
        await this.emit('joined', {
          room: roomId, player: user, spectator: player?.spectator ?? true,
          host: player?.isHost ?? false, status: room.status,
        });
        // Only announce the reconnect if the disconnect was actually broadcast;
        // a quick refresh (announce still pending) is invisible to the room.
        if (announced) {
          await this.emit('playerReconnected', { room: roomId, player: user });
          await this._sysMsg(roomId, `${user} reconnected.`);
        }
        await this._snapshotTo(roomId, room.game, user, player?.spectator ?? true);
        await this._rosterBroadcast(roomId);
        LOG.info('RECONNECT', roomId, user);
        return this._role(player);
      }

      // -- already in room (idempotent) — re-emit joined so client can build view
      const existing = await SELECT.one.from(Players).where({ room_ID: roomId, user });
      if (existing) {
        await this.emit('joined', {
          room: roomId, player: user, spectator: existing.spectator,
          host: existing.isHost, status: room.status,
        });
        await this._snapshotTo(roomId, room.game, user, existing.spectator);
        await this._rosterBroadcast(roomId);
        return this._role(existing);
      }

      // -- assign slot: a player while seats remain AND the room is still in
      // the lobby, otherwise a spectator (joining mid-match never grants a
      // live seat, even if one is technically open — host can promote via
      // setRole once they've seen the room)
      const players = await SELECT.from(Players).where({ room_ID: roomId });
      const seatsTaken = players.filter(p => !p.spectator).length;
      // No game yet (empty room) → no seat cap; everyone waits as a player until
      // a game is chosen, then switchGame re-splits against its maxPlayers.
      const maxSeats = game ? game.meta.maxPlayers : Infinity;
      const spectator = room.status !== 'lobby' || seatsTaken >= maxSeats;

      const isHost = players.length === 0;  // first to join is host
      await INSERT.into(Players).entries({ room_ID: roomId, user, spectator, isHost });

      // init board if not yet
      if (!eng.getBoard(roomId) && room.status === 'playing') {
        eng.initBoard(roomId, room.game, room.settings, await this._roster(roomId));
      }

      await this.emit('joined', {
        room: roomId, player: user, spectator,
        host: isHost, status: room.status,
      });
      await this._sysMsg(roomId, `${user} joined.`);
      if (room.status === 'playing') await this._snapshotTo(roomId, room.game, user, spectator);
      await this._rosterBroadcast(roomId);
      LOG.info('JOIN', roomId, user, '→', spectator ? 'spectator' : 'player', isHost ? '(host)' : '');
      return this._role({ spectator });
    });

    // -------------------------------------------------------------- configure
    this.on('configure', async (req) => {
      const { room: roomId, settings } = req.data;
      const { err } = await this._roomGuard(req, roomId, 'configure');
      if (err) return;
      await UPDATE(Rooms, roomId).with({ settings });
      await this.emit('configured', { room: roomId, settings });
      LOG.info('CONFIG', roomId, req.user.id, settings);
    });

    // ----------------------------------------------------------------- start
    this.on('start', async (req) => {
      const { room: roomId } = req.data;
      const { room, err } = await this._roomGuard(req, roomId, 'start');
      if (err) return;

      const players = await SELECT.from(Players).where({ room_ID: roomId });
      const game = reg.get(room.game);
      if (!game) return this._error(req, roomId, 'pick a game before starting');
      const realPlayers = players.filter(p => !p.spectator);

      if (realPlayers.length < game.meta.minPlayers)
        return this._error(req, roomId, `need ${game.meta.minPlayers} players to start`);

      const b = eng.initBoard(roomId, room.game, room.settings, await this._roster(roomId));
      await UPDATE(Rooms, roomId).with({ status: 'playing' });

      await this._broadcastState(roomId, room.game, b, 'started', { firstTurn: b.turn });
      LOG.info('START', roomId, 'firstTurn=' + b.turn);
    });

    // ------------------------------------------------------------------ move
    this.on('move', async (req) => {
      const { room: roomId, data } = req.data;
      const user = req.user.id;

      const room = await SELECT.one.from(Rooms, roomId).columns('status','game','settings','host');
      if (!room) return this._error(req, roomId, 'room not found');

      const statusErr = eng.guardStatus(room.status, 'move');
      if (statusErr) return this._error(req, roomId, statusErr);

      const player = await SELECT.one.from(Players).where({ room_ID: roomId, user });
      if (!player || player.spectator)
        return this._error(req, roomId, 'you are a spectator');

      const b = eng.getBoard(roomId);
      if (!b) return this._error(req, roomId, 'no active board — rejoin');

      const move = typeof data === 'string' ? JSON.parse(data) : data;
      const result = reg.get(room.game).applyMove(b.state, move, user);

      if (result.error) return this._error(req, roomId, result.error);

      b.state = result.state;
      b.turn  = result.state.turn ?? b.turn;

      if (result.end) {
        await UPDATE(Rooms, roomId).with({ status: 'finished' });
        const allPlayers = await SELECT.from(Players).where({ room_ID: roomId });
        await this._persistMatch(room, roomId, result, allPlayers);
        await this._broadcastState(roomId, room.game, b, 'finished', { winner: result.end.winner });
        LOG.info('END', roomId, 'winner=' + result.end.winner);
      } else {
        await this._broadcastState(roomId, room.game, b, 'moved', {});
        LOG.info('MOVE', roomId, user, 'next=' + b.turn);
      }
    });

    // --------------------------------------------------------------- rematch
    this.on('rematch', async (req) => {
      const { room: roomId } = req.data;
      const { room, err } = await this._roomGuard(req, roomId, 'rematch');
      if (err) return;
      const b = eng.initBoard(roomId, room.game, room.settings, await this._roster(roomId));
      await UPDATE(Rooms, roomId).with({ status: 'playing' });
      await this._broadcastState(roomId, room.game, b, 'rematched', { firstTurn: b.turn });
      LOG.info('REMATCH', roomId, 'by', req.user.id);
    });

    // ------------------------------------------------------------- backToRoom
    this.on('backToRoom', async (req) => {
      const { room: roomId } = req.data;
      const { err } = await this._roomGuard(req, roomId, 'backToRoom');
      if (err) return;
      eng.deleteBoard(roomId);
      await UPDATE(Rooms, roomId).with({ status: 'lobby' });
      await this.emit('roomReset', { room: roomId });
      LOG.info('ROOM', roomId, 'back to waiting state, by', req.user.id);
    });

    // ------------------------------------------------------------ switchGame
    this.on('switchGame', async (req) => {
      const { room: roomId, game: newGame } = req.data;
      const { err } = await this._roomGuard(req, roomId, 'switchGame');
      if (err) return;

      const game = reg.get(newGame);
      if (!game) return this._error(req, roomId, `unknown game: ${newGame}`);

      await UPDATE(Rooms, roomId).with({ game: newGame, settings: '{}' });

      // re-split existing roster into player/spectator against the new game's
      // maxPlayers — host first, then stable by user id (see _roster()).
      const roster = await this._roster(roomId);          // players only, ordered
      const keepAsPlayers = new Set(roster.slice(0, game.meta.maxPlayers).map(p => p.user));
      const all = await SELECT.from(Players).where({ room_ID: roomId });
      for (const p of all) {
        const shouldBeSpectator = !keepAsPlayers.has(p.user);
        if (p.spectator !== shouldBeSpectator) {
          await UPDATE(Players).set({ spectator: shouldBeSpectator }).where({ room_ID: roomId, user: p.user });
          await this.emit('roleChanged', { room: roomId, player: p.user, spectator: shouldBeSpectator });
        }
      }

      await this.emit('gameSwitched', {
        room: roomId, game: newGame,
        name: game.meta.name, minPlayers: game.meta.minPlayers, maxPlayers: game.meta.maxPlayers,
      });
      await this._rosterBroadcast(roomId);
      await this._sysMsg(roomId, `Host switched the game to ${game.meta.name}.`);
      LOG.info('SWITCH', roomId, '→', newGame, 'by', req.user.id);
    });

    // ---------------------------------------------------------------- setRole
    this.on('setRole', async (req) => {
      const { room: roomId, user: target, spectator } = req.data;
      const { room, err } = await this._roomGuard(req, roomId, 'setRole');
      if (err) return;

      const player = await SELECT.one.from(Players).where({ room_ID: roomId, user: target });
      if (!player) return this._error(req, roomId, 'player not found');
      if (player.spectator === spectator) return; // no-op

      if (!spectator) {
        const game = reg.get(room.game);
        const players = await SELECT.from(Players).where({ room_ID: roomId });
        const seatsTaken = players.filter(p => !p.spectator).length;
        if (seatsTaken >= game.meta.maxPlayers)
          return this._error(req, roomId, 'no seats available');
      }

      await UPDATE(Players).set({ spectator }).where({ room_ID: roomId, user: target });
      await this.emit('roleChanged', { room: roomId, player: target, spectator });
      await this._sysMsg(roomId, `${target} is now a ${spectator ? 'spectator' : 'player'}.`);
      LOG.info('ROLE', roomId, target, '→', spectator ? 'spectator' : 'player', 'by', req.user.id);
    });

    // ------------------------------------------------------------------ kick
    this.on('kick', async (req) => {
      const { room: roomId, user: target } = req.data;
      const user = req.user.id;
      const room = await SELECT.one.from(Rooms, roomId).columns('status','host','game','settings');
      if (!room) return this._error(req, roomId, 'room not found');
      if (eng.guardHost(room, user)) return this._error(req, roomId, 'only host can do this');
      if (target === user) return this._error(req, roomId, 'cannot kick yourself');

      const player = await SELECT.one.from(Players).where({ room_ID: roomId, user: target });
      if (!player) return this._error(req, roomId, 'player not found');

      await DELETE.from(Players).where({ room_ID: roomId, user: target });

      if (['playing', 'paused'].includes(room.status)) {
        eng.deleteBoard(roomId);
        await UPDATE(Rooms, roomId).with({ status: 'lobby' });
      }
      await this._succeedHostIfNeeded(room, roomId, target);
      await this.emit('playerKicked', { room: roomId, player: target });
      await this._sysMsg(roomId, `${target} was kicked.`);
      if (['playing', 'paused'].includes(room.status))
        await this.emit('roomReset', { room: roomId });
      await this._autoDelete(roomId);
      LOG.info('KICK', roomId, target, 'by', user);
    });

    // ----------------------------------------------------------------- leave
    this.on('leave', async (req) => {
      const { room: roomId } = req.data;
      await this._doLeave(req.user.id, roomId);
    });

    // -------------------------------------------------------------- chat
    this.on('chat', async (req) => {
      const { room: roomId, text } = req.data;
      const user = req.user.id;
      await this.emit('chatMessage', {
        room: roomId, player: user, text,
        ts: new Date().toISOString(),
      });
      LOG.info('CHAT', roomId, user, text.slice(0, 40));
    });

    // --------------------------------------------------------- wsDisconnect
    this.on('wsDisconnect', async (req) => {
      const user = req.user.id;
      const rooms = await SELECT.from(Rooms)
        .columns('ID','status','game','settings','host')
        .where({ status: { in: ['playing', 'lobby', 'paused', 'finished'] } });

      // Batch this user's seats across all live rooms in one query instead of
      // a SELECT per room (was N+1).
      const roomIds = rooms.map(r => r.ID);
      const seats = await SELECT.from(Players).where({ room_ID: { in: roomIds }, user });
      const playerByRoom = Object.fromEntries(seats.map(p => [p.room_ID, p]));

      for (const room of rooms) {
        const player = playerByRoom[room.ID];
        if (!player) continue;

        // Grace period in ANY status — a transient drop (network blip, tab
        // backgrounded) should never silently and permanently remove someone,
        // whether mid-game or just sitting in the room between games. Only
        // an active player disconnecting mid-match flips the room to 'paused'
        // (mid-match pause semantics) — a spectator dropping never affects
        // the match in progress; other statuses hold the player provisionally
        // as-is.
        if (room.status === 'playing' && !player.spectator) {
          await UPDATE(Rooms, room.ID).with({ status: 'paused' });
        }
        eng.setGraceTimer(room.ID, user, () => {
          this._doLeave(user, room.ID, true).catch(() => {});
        });
        // Debounce the "disconnected" broadcast: a page refresh reconnects
        // within a few hundred ms, so only a drop that outlasts the announce
        // window ever reaches the other players (a quick refresh stays silent).
        eng.setAnnounceTimer(room.ID, user, () => {
          this.emit('playerDisconnected', { room: room.ID, player: user }).catch(() => {});
          this._sysMsg(room.ID, `${user} disconnected.`).catch(() => {});
        });
        LOG.info('DISCONNECT', room.ID, user, `→ status=${room.status} (60s grace, 3s announce)`);
      }
    });

    // --- Server-driven ticks -------------------------------------------------
    // Generic driver for games that declare `meta.tick` + `onTick(state,
    // elapsedMs)` (e.g. mttt's per-move blitz). The platform owns the timer, so
    // a game stays a pure reducer and never reaches into engine.js's board
    // state: each tick we hand the game how long the current turn has run, and
    // if it returns a new state we broadcast it exactly like a real move.
    const tickTimers = new Map();   // roomId -> interval handle

    const clearTick = (roomId) => {
      clearInterval(tickTimers.get(roomId));
      tickTimers.delete(roomId);
    };

    const armTick = (roomId) => {
      const b = eng.getBoard(roomId);
      if (!b) return;
      const game = reg.get(b.game);
      if (!game?.onTick || !game.meta?.tick) return;
      clearTick(roomId);
      b.turnAt = Date.now();
      const everyMs = game.meta.tick.everyMs ?? 1000;
      tickTimers.set(roomId, setInterval(() => tick(roomId), everyMs));
    };

    const tick = async (roomId) => {
      const b = eng.getBoard(roomId);
      const game = b && reg.get(b.game);
      if (!game?.onTick) return clearTick(roomId);
      const room = await SELECT.one.from(Rooms, roomId).columns('status');
      if (!room) return clearTick(roomId);
      if (room.status !== 'playing') return;   // paused/finished: hold, don't skip
      const res = game.onTick(b.state, Date.now() - (b.turnAt ?? Date.now()));
      if (!res?.state) return;
      b.state  = res.state;
      b.turn   = res.state.turn ?? b.turn;
      b.turnAt = Date.now();
      if (res.end) {
        await UPDATE(Rooms, roomId).with({ status: 'finished' });
        const players = await SELECT.from(Players).where({ room_ID: roomId });
        await this._persistMatch({ game: b.game }, roomId, { end: res.end }, players);
        await this._broadcastState(roomId, b.game, b, 'finished', { winner: res.end.winner });
        clearTick(roomId);
        LOG.info('TICK-END', roomId, 'winner=' + res.end.winner);
      } else {
        await this._broadcastState(roomId, b.game, b, 'moved', {});
      }
      if (res.sys) await this._sysMsg(roomId, res.sys);
    };

    // Arm on the events that begin a turn; a real move (or a skip's own 'moved'
    // broadcast) restarts the current turn's clock; clear when the match/board
    // ends. Don't burn the mover's clock while they're disconnected (paused).
    this.on('started',   (req) => armTick(req.data.room));
    this.on('rematched', (req) => armTick(req.data.room));
    this.on('moved',     (req) => { const b = eng.getBoard(req.data.room); if (b) b.turnAt = Date.now(); });
    this.on('finished',     (req) => clearTick(req.data.room));
    this.on('roomReset',    (req) => clearTick(req.data.room));
    this.on('gameSwitched', (req) => clearTick(req.data.room));
    this.on('playerDisconnected', (req) => {
      const b = eng.getBoard(req.data.room);
      if (b?.state?.turn === req.data.player) clearTick(req.data.room);
    });
    this.on('playerReconnected', (req) => {
      const b = eng.getBoard(req.data.room);
      if (b && b.state?.turn === req.data.player && !b.state?.winner) armTick(req.data.room);
    });

    // Games have already self-registered onto cds.games via their cds-plugin.js
    // (run during cds.plugins, before serving). Validate them and wire any
    // service extensions (extra pre-start actions/events).
    cds.on('served', async () => {
      for (const [id, game] of Object.entries(reg.all())) {
        try {
          reg.validate(id, game);
        } catch (e) {
          LOG.error(`invalid game plugin '${id}': ${e.message}`);
          continue;
        }
        if (typeof game.extendService === 'function') {
          game.extendService(this);
          LOG.info(`extended PlayService with game: ${id}`);
        }
      }
    });

    await super.init();
  }

  // ---------------------------------------------------------------- helpers

  async _roomGuard(req, roomId, action) {
    const room = await SELECT.one.from('cap.games.Rooms', roomId)
      .columns('ID','status','host','game','settings');
    if (!room) { this._error(req, roomId, 'room not found'); return { err: true }; }
    const hostErr = eng.guardHost(room, req.user.id);
    if (hostErr) { this._error(req, roomId, hostErr); return { err: true }; }
    const statusErr = eng.guardStatus(room.status, action);
    if (statusErr) { this._error(req, roomId, statusErr); return { err: true }; }
    return { room };
  }

  _error(req, room, message) {
    return this.emit('gameError', { room: room ?? '', message });
  }

  _sysMsg(room, text) {
    return this.emit('chatMessage', { room, player: 'system', text, ts: new Date().toISOString() });
  }

  /** Role string returned by join() so the client knows if it may move. */
  _role(player) { return player?.spectator ? 'spectator' : 'player'; }

  /**
   * Ordered roster of *players* (no spectators) handed to a game's init(): host
   * first, then by original join order (createdAt) for a stable order. Games
   * that need per-seat marks (e.g. tic-tac-toe's X/O) derive them from this
   * order. Also used by switchGame() to decide who keeps a seat.
   */
  async _roster(roomId) {
    const players = await SELECT.from('cap.games.Players').where({ room_ID: roomId });
    return players
      .filter(p => !p.spectator)
      .sort((a, b) => (b.isHost ? 1 : 0) - (a.isHost ? 1 : 0) || new Date(a.createdAt) - new Date(b.createdAt))
      .map(p => ({ user: p.user, isHost: p.isHost }));
  }

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
  async _broadcastState(roomId, gameId, b, event, extra = {}) {
    const game = reg.get(gameId);
    if (!_hasProjection(game)) {
      const full = JSON.stringify(b.state);
      await this.emit(event, { room: roomId, ...extra, state: full, data: full });
      return;
    }

    const pub = JSON.stringify(game.publicState(b.state));
    await this.emit(event, { room: roomId, ...extra, state: pub, data: pub });

    const players = await SELECT.from('cap.games.Players').where({ room_ID: roomId });
    for (const p of players) {
      const slice = _sliceFor(game, b.state, p.user, p.spectator, pub);
      await this.emit('privateState', { room: roomId, data: slice }, { user: { include: [p.user] } });
    }
  }

  /**
   * Send the current state snapshot to a single (re)joining user: their private
   * slice plus the public table, so they can render immediately. No-op if the
   * game has no active board or does not use projection.
   */
  async _snapshotTo(roomId, gameId, user, isSpectator) {
    const b = eng.getBoard(roomId);
    if (!b) return;
    const game = reg.get(gameId);
    if (!_hasProjection(game)) {
      // legacy games: resend full state to this user only
      const full = JSON.stringify(b.state);
      await this.emit('moved', { room: roomId, data: full }, { user: { include: [user] } });
      return;
    }
    const pub = JSON.stringify(game.publicState(b.state));
    await this.emit('privateState', { room: roomId, data: _sliceFor(game, b.state, user, isSpectator, pub) }, { user: { include: [user] } });
    await this.emit('moved', { room: roomId, data: pub }, { user: { include: [user] } });
  }

  /**
   * Full current roster (players + spectators), JSON-encoded — sent to (re)sync
   * a client's player list, e.g. on join to an existing room or a game switch,
   * where the client's UI (re)initializes and would otherwise only ever see
   * *future* joined/playerLeft deltas, missing anyone already present.
   */
  async _rosterPayload(roomId) {
    const players = await SELECT.from('cap.games.Players').where({ room_ID: roomId });
    return JSON.stringify(players.map(p => ({ user: p.user, spectator: p.spectator, isHost: p.isHost })));
  }

  async _rosterBroadcast(roomId) {
    await this.emit('roster', { room: roomId, players: await this._rosterPayload(roomId) });
  }

  async _doLeave(user, roomId, fromTimeout = false) {
    const { Rooms, Players } = cds.entities('cap.games');

    eng.clearGraceTimer(roomId, user);
    eng.clearAnnounceTimer(roomId, user);   // no stale "disconnected" after they're gone

    const room = await SELECT.one.from(Rooms, roomId)
      .columns('status','host','game','settings');
    if (!room) return;

    const player = await SELECT.one.from(Players).where({ room_ID: roomId, user });
    if (!player) return;

    const wasPlaying = ['playing', 'paused'].includes(room.status);
    await DELETE.from(Players).where({ room_ID: roomId, user });

    if (wasPlaying) {
      eng.deleteBoard(roomId);
      await UPDATE(Rooms, roomId).with({ status: 'lobby' });
    }

    const newHost = await this._succeedHostIfNeeded(room, roomId, user);
    await this.emit('playerLeft', {
      room: roomId, player: user,
      newHost: newHost ?? '',
    });
    await this._sysMsg(roomId, `${user} left.`);
    if (wasPlaying) await this.emit('roomReset', { room: roomId });

    await this._autoDelete(roomId);
    LOG.info(fromTimeout ? 'TIMEOUT' : 'LEAVE', roomId, user,
      newHost ? '→ newHost=' + newHost : '');
  }

  async _succeedHostIfNeeded(room, roomId, leavingUser) {
    const { Rooms, Players } = cds.entities('cap.games');
    if (room.host !== leavingUser) return null;

    const remaining = await SELECT.from(Players)
      .where({ room_ID: roomId });
    const next = remaining.find(p => p.user !== leavingUser);
    if (!next) return null;

    await UPDATE(Rooms, roomId).with({ host: next.user });
    await UPDATE(Players).set({ isHost: true }).where({ room_ID: roomId, user: next.user });
    return next.user;
  }

  async _autoDelete(roomId) {
    const { Rooms, Players } = cds.entities('cap.games');
    const count = await SELECT.one.from(Players).where({ room_ID: roomId }).columns('count(*) as n');
    const gracePending = eng.allGraceTimers(roomId).length > 0;
    if ((count?.n ?? 0) === 0 && !gracePending) {
      await DELETE.from(Rooms, roomId);
      eng.deleteBoard(roomId);
      LOG.info('ROOM', roomId, 'deleted (empty)');
    }
  }

  async _persistMatch(room, roomId, result, players) {
    const { Matches, Leaderboard } = cds.entities('cap.games');

    await INSERT.into(Matches).entries({
      game: room.game,
      room: roomId,
      winner: result.end.winner,
      players: JSON.stringify(players.map(p => ({ user: p.user, spectator: p.spectator }))),
      state: JSON.stringify(eng.getBoard(roomId)?.state ?? {}),
    });

    const game = reg.get(room.game);
    const scores = typeof game.score === 'function'
      ? game.score(result.end, players)
      : eng.defaultScore(result.end, players,
          game.pointsOf ? { pointsOf: u => game.pointsOf(result.end, u) } : {});

    for (const s of scores) {
      // DB-side increments instead of read-modify-write: avoids a lost update
      // if two matches for the same user/game finish concurrently. The
      // returned affected-row count tells us whether a row existed to bump;
      // if not, insert the first one. (Plain UPDATE against the db — not
      // through a service — returns a bare number, not `{ affected }`.)
      const winsDelta   = s.result === 'win'  ? 1 : 0;
      const lossesDelta = s.result === 'loss' ? 1 : 0;
      const drawsDelta  = s.result === 'draw' ? 1 : 0;
      const pointsDelta = s.points ?? 0;

      const affected = await UPDATE(Leaderboard)
        .set({
          wins:   { '+=': winsDelta },
          losses: { '+=': lossesDelta },
          draws:  { '+=': drawsDelta },
          points: { '+=': pointsDelta },
        })
        .where({ user: s.user, game: room.game });

      if (!affected) {
        await INSERT.into(Leaderboard).entries({
          user: s.user, game: room.game,
          wins:   winsDelta,
          losses: lossesDelta,
          draws:  drawsDelta,
          points: pointsDelta,
        });
      }
    }

    await this._awardAchievements(room.game, roomId, result.end, players);
  }

  // Evaluate + persist achievements for every player of a finished match, then
  // privately notify anyone who unlocked something. Runs after Leaderboard is
  // updated so the meta (aggregate) tier sees this match. Sources:
  //   A. game.checkAchievements — single-match, pure (per game)
  //   B. ach.evaluateMeta       — cross-game aggregate (platform)
  async _awardAchievements(gameId, roomId, end, players) {
    const { Unlocks } = cds.entities('cap.games');
    const game = reg.get(gameId);
    const state = eng.getBoard(roomId)?.state ?? {};

    for (const p of players.filter(pl => !pl.spectator)) {
      const candidates = [
        ...(game.checkAchievements?.(end, state, p.user) ?? []).map(id => ({ id, game: gameId })),
        ...(await ach.evaluateMeta({ user: p.user, end })).map(id => ({ id, game: '' })),
      ];

      if (!candidates.length) continue;

      // One lookup for all of this player's existing unlocks instead of a
      // SELECT per candidate.
      const owned = await SELECT.from(Unlocks).columns('id', 'game').where({ user: p.user });
      const ownedKeys = new Set(owned.map(o => `${o.game} ${o.id}`));

      const fresh = [];
      for (const c of candidates) {
        if (ownedKeys.has(`${c.game} ${c.id}`)) continue;
        ownedKeys.add(`${c.game} ${c.id}`); // dedupe within this batch too
        await INSERT.into(Unlocks).entries({ user: p.user, id: c.id, game: c.game, at: new Date().toISOString() });
        fresh.push({ id: c.id, game: c.game, ...ach.label(c.game, c.id) });
      }

      if (fresh.length) {
        LOG.info('ACHIEVEMENT', p.user, fresh.map(f => f.id).join(','));
        await this.emit('achievementUnlocked', { unlocked: JSON.stringify(fresh) }, { user: { include: [p.user] } });
      }
    }
  }
}

export default PlayService;
