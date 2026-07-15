const cds  = require('@sap/cds');
const LOG  = cds.log('game');
const eng  = require('./engine');
const reg  = require('./registry');

class PlayService extends cds.ApplicationService {

  async init() {
    // Access entities via namespace (cross-package service)
    const { Rooms, Players, Matches, Leaderboard } = cds.entities('cap.games');

    // ------------------------------------------------------------------ join
    this.on('join', async (req) => {
      const { room: roomId } = req.data;
      const user = req.user.id;

      const room = await SELECT.one.from(Rooms).where({ ID: roomId })
        .columns('ID','game','host','status','settings');
      if (!room) return this._error(req, roomId, 'room not found');

      const game = reg.get(room.game);
      if (!game) return this._error(req, roomId, `unknown game: ${room.game}`);

      await req.context.ws.service.enter(roomId);

      // -- reconnect: had grace timer running
      if (eng.hasGraceTimer(roomId, user)) {
        eng.clearGraceTimer(roomId, user);
        const player = await SELECT.one.from(Players)
          .where({ room_ID: roomId, user });
        if (room.status === 'paused') {
          await UPDATE(Rooms, roomId).with({ status: 'playing' });
        }
        await this.emit('playerReconnected', { room: roomId, player: user, symbol: player?.symbol ?? '' });
        LOG.info('RECONNECT', roomId, user);
        return player?.symbol ?? 'spectator';
      }

      // -- already in room (idempotent) — re-emit joined so client can build view
      const existing = await SELECT.one.from(Players).where({ room_ID: roomId, user });
      if (existing) {
        await this.emit('joined', {
          room: roomId, player: user, symbol: existing.symbol,
          host: existing.isHost, status: room.status,
        });
        return existing.symbol;
      }

      // -- assign slot
      const players = await SELECT.from(Players).where({ room_ID: roomId });
      const takenSymbols = players.map(p => p.symbol).filter(s => s !== 'spectator');
      const maxPlayers = game.meta.maxPlayers;

      let symbol = 'spectator';
      const symbols = ['X', 'O', 'A', 'B', 'C', 'D'];  // extensible for team-play later
      for (const s of symbols.slice(0, maxPlayers)) {
        if (!takenSymbols.includes(s)) { symbol = s; break; }
      }

      const isHost = players.length === 0;  // first to join is host
      await INSERT.into(Players).entries({ room_ID: roomId, user, symbol, isHost });

      // init board if not yet
      if (!eng.getBoard(roomId) && room.status === 'playing') {
        eng.initBoard(roomId, room.game, room.settings);
      }

      await this.emit('joined', {
        room: roomId, player: user, symbol,
        host: isHost, status: room.status,
      });
      LOG.info('JOIN', roomId, user, '→', symbol, isHost ? '(host)' : '');
      return symbol;
    });

    // -------------------------------------------------------------- configure
    this.on('configure', async (req) => {
      const { room: roomId, settings } = req.data;
      const { room, err } = await this._roomGuard(req, roomId, 'configure');
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
      const realPlayers = players.filter(p => p.symbol !== 'spectator');

      if (realPlayers.length < game.meta.minPlayers)
        return this._error(req, roomId, `need ${game.meta.minPlayers} players to start`);

      const b = eng.initBoard(roomId, room.game, room.settings);
      await UPDATE(Rooms, roomId).with({ status: 'playing' });

      await this.emit('started', { room: roomId, firstTurn: b.turn, state: JSON.stringify(b.state) });
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
      if (!player || player.symbol === 'spectator')
        return this._error(req, roomId, 'you are a spectator');

      const b = eng.getBoard(roomId);
      if (!b) return this._error(req, roomId, 'no active board — rejoin');

      const move = typeof data === 'string' ? JSON.parse(data) : data;
      const result = reg.get(room.game).applyMove(b.state, move, player.symbol);

      if (result.error) return this._error(req, roomId, result.error);

      b.state = result.state;
      b.turn  = result.state.turn ?? b.turn;

      if (result.end) {
        await UPDATE(Rooms, roomId).with({ status: 'finished' });
        const allPlayers = await SELECT.from(Players).where({ room_ID: roomId });
        await this._persistMatch(room, roomId, result, allPlayers);
        await this.emit('finished', {
          room: roomId, winner: result.end.winner, state: JSON.stringify(b.state),
        });
        LOG.info('END', roomId, 'winner=' + result.end.winner);
      } else {
        await this.emit('moved', { room: roomId, data: JSON.stringify(b.state) });
        LOG.info('MOVE', roomId, `${user}(${player.symbol})`, 'next=' + b.turn);
      }
    });

    // --------------------------------------------------------------- rematch
    this.on('rematch', async (req) => {
      const { room: roomId } = req.data;
      const { room, err } = await this._roomGuard(req, roomId, 'rematch');
      if (err) return;
      const b = eng.initBoard(roomId, room.game, room.settings);
      await UPDATE(Rooms, roomId).with({ status: 'playing' });
      await this.emit('rematched', { room: roomId, firstTurn: b.turn, state: JSON.stringify(b.state) });
      LOG.info('REMATCH', roomId, 'by', req.user.id);
    });

    // ----------------------------------------------------------- backToLobby
    this.on('backToLobby', async (req) => {
      const { room: roomId } = req.data;
      const { err } = await this._roomGuard(req, roomId, 'backToLobby');
      if (err) return;
      eng.deleteBoard(roomId);
      await UPDATE(Rooms, roomId).with({ status: 'lobby' });
      await this.emit('lobbyReset', { room: roomId });
      LOG.info('LOBBY', roomId, 'by', req.user.id);
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
      if (['playing', 'paused'].includes(room.status))
        await this.emit('lobbyReset', { room: roomId });
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
        .where({ status: { in: ['playing', 'lobby', 'paused'] } });

      for (const room of rooms) {
        const player = await SELECT.one.from(Players)
          .where({ room_ID: room.ID, user });
        if (!player) continue;

        if (room.status === 'playing') {
          // grace period — pause
          await UPDATE(Rooms, room.ID).with({ status: 'paused' });
          eng.setGraceTimer(room.ID, user, () => {
            this._doLeave(user, room.ID, true).catch(() => {});
          });
          await this.emit('playerDisconnected', {
            room: room.ID, player: user, symbol: player.symbol,
          });
          LOG.info('DISCONNECT', room.ID, user, player.symbol, '→ paused (60s grace)');
        } else {
          await this._doLeave(user, room.ID);
        }
      }
    });

    // register game-specific extensions + validate all loaded games
    cds.on('served', () => {
      reg.loadAll();
      for (const [id, game] of Object.entries(reg.all())) {
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

  async _doLeave(user, roomId, fromTimeout = false) {
    const { Rooms, Players } = cds.entities('cap.games');

    eng.clearGraceTimer(roomId, user);

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
      symbol: player.symbol ?? 'spectator',
      newHost: newHost ?? '',
    });
    if (wasPlaying) await this.emit('lobbyReset', { room: roomId });

    await this._autoDelete(roomId);
    LOG.info(fromTimeout ? 'TIMEOUT' : 'LEAVE', roomId, user, player.symbol ?? 'spectator',
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
      players: JSON.stringify(players.map(p => ({ user: p.user, symbol: p.symbol }))),
      state: JSON.stringify(eng.getBoard(roomId)?.state ?? {}),
    });

    const game = reg.get(room.game);
    const scores = typeof game.score === 'function'
      ? game.score(result.end, players)
      : eng.defaultScore(result.end, players);

    for (const s of scores) {
      const existing = await SELECT.one.from(Leaderboard).where({ user: s.user, game: room.game });
      if (existing) {
        await UPDATE(Leaderboard).set({
          wins:   existing.wins   + (s.result === 'win'  ? 1 : 0),
          losses: existing.losses + (s.result === 'loss' ? 1 : 0),
          draws:  existing.draws  + (s.result === 'draw' ? 1 : 0),
          points: existing.points + (s.points ?? 0),
        }).where({ user: s.user, game: room.game });
      } else {
        await INSERT.into(Leaderboard).entries({
          user: s.user, game: room.game,
          wins:   s.result === 'win'  ? 1 : 0,
          losses: s.result === 'loss' ? 1 : 0,
          draws:  s.result === 'draw' ? 1 : 0,
          points: s.points ?? 0,
        });
      }
    }
  }
}

module.exports = PlayService;
