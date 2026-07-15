const cds = require('@sap/cds');
const LOG = cds.log('game');
const { GAMES, rooms, guardStatus, guardHost, removePlayer, resetToLobby, resetToPlaying, GRACE_MS } = require('./games/engine');

// --- Register game modules ---
GAMES['tictactoe'] = require('./games/tictactoe');

module.exports = (srv) => {

  // --- join ---
  srv.on('join', async (req) => {
    const { room, game = 'tictactoe' } = req.data;
    const user = req.user.id;

    if (!GAMES[game]) return error(req, room, `unknown game: ${game}`);

    // init room if new
    const r = rooms[room] ??= {
      game, host: null,
      players: {}, spectators: new Set(),
      status: 'lobby', firstPlayer: 'X',
      state: GAMES[game].init(), turn: 'X',
      disconnected: new Map(),
    };

    await req.context.ws.service.enter(room);

    // reconnect: player was in room and has active grace timer
    if (r.disconnected.has(user)) {
      clearTimeout(r.disconnected.get(user));
      r.disconnected.delete(user);
      const symbol = r.players.X === user ? 'X' : r.players.O === user ? 'O' : null;
      if (r.status === 'paused' && Object.keys(r.players).length >= GAMES[game].minPlayers) {
        r.status = 'playing';
      }
      await srv.emit('playerReconnected', { room, player: user, symbol });
      LOG.info('RECONNECT', room, user, symbol);
      return symbol;
    }

    // already in room (idempotent re-join, e.g. page refresh without grace)
    if (r.players.X === user) return 'X';
    if (r.players.O === user) return 'O';
    if (r.spectators.has(user)) return 'spectator';

    // assign slot
    const gm = GAMES[game];
    let symbol = 'spectator';
    if (!r.players.X)                               { r.players.X = user; symbol = 'X'; }
    else if (!r.players.O && Object.keys(r.players).length < gm.maxPlayers)
                                                    { r.players.O = user; symbol = 'O'; }
    else                                            { r.spectators.add(user); }

    if (!r.host) r.host = user;

    await srv.emit('joined', { room, player: user, symbol, host: r.host === user, status: r.status });
    LOG.info('JOIN', room, user, '→', symbol, r.host === user ? '(host)' : '');
    return symbol;
  });

  // --- configure (host, lobby) ---
  srv.on('configure', async (req) => {
    const { room, firstPlayer } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardHost(r, req.user.id) || guardStatus(r, 'configure') ;
    if (err) return error(req, room, err);
    r.firstPlayer = firstPlayer;
    await srv.emit('configured', { room, firstPlayer });
    LOG.info('CONFIG', room, 'firstPlayer=' + firstPlayer);
  });

  // --- start (host, lobby → playing) ---
  srv.on('start', async (req) => {
    const { room } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardHost(r, req.user.id) || guardStatus(r, 'start');
    if (err) return error(req, room, err);
    const playerCount = [r.players.X, r.players.O].filter(Boolean).length;
    if (playerCount < GAMES[r.game].minPlayers)
      return error(req, room, `need ${GAMES[r.game].minPlayers} players to start`);
    resetToPlaying(r);
    await srv.emit('started', { room, firstPlayer: r.turn });
    LOG.info('START', room, 'firstPlayer=' + r.turn, 'playing');
  });

  // --- move (playing) ---
  srv.on('move', async (req) => {
    const { room, data } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardStatus(r, 'move');
    if (err) return error(req, room, err);
    const symbol = r.players.X === req.user.id ? 'X' : r.players.O === req.user.id ? 'O' : null;
    if (!symbol) return error(req, room, 'you are a spectator');

    const move = typeof data === 'string' ? JSON.parse(data) : data;
    const result = GAMES[r.game].applyMove(r.state, move, symbol);
    if (result.error) return error(req, room, result.error);

    r.state = result.state;
    r.turn = r.state.turn;
    const stateJson = JSON.stringify(r.state);

    if (result.end) {
      r.status = 'finished';
      await srv.emit('finished', { room, winner: result.end.winner, state: stateJson });
      LOG.info('END', room, 'winner=' + result.end.winner);
    } else {
      await srv.emit('moved', { room, data: stateJson });
      LOG.info('MOVE', room, `${req.user.id}(${symbol})`, 'next=' + r.turn);
    }
  });

  // --- rematch (host, finished → playing) ---
  srv.on('rematch', async (req) => {
    const { room } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardHost(r, req.user.id) || guardStatus(r, 'rematch');
    if (err) return error(req, room, err);
    resetToPlaying(r);
    await srv.emit('rematched', { room });
    LOG.info('REMATCH', room, 'by', req.user.id, 'firstPlayer=' + r.turn);
  });

  // --- backToLobby (host, any → lobby) ---
  srv.on('backToLobby', async (req) => {
    const { room } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardHost(r, req.user.id) || guardStatus(r, 'backToLobby');
    if (err) return error(req, room, err);
    resetToLobby(r);
    await srv.emit('lobbyReset', { room });
    LOG.info('LOBBY', room, 'by', req.user.id);
  });

  // --- kick (host) ---
  srv.on('kick', async (req) => {
    const { room, user } = req.data;
    const r = rooms[room];
    if (!r) return error(req, room, 'room not found');
    const err = guardHost(r, req.user.id);
    if (err) return error(req, room, err);
    if (user === req.user.id) return error(req, room, 'cannot kick yourself');
    const { deleted } = removePlayer(r, room, user);
    if (['playing', 'paused'].includes(r.status)) resetToLobby(r);
    await srv.emit('playerKicked', { room, player: user });
    LOG.info('KICK', room, user, 'by', req.user.id);
    if (deleted) return;
    if (r.status === 'lobby') await srv.emit('lobbyReset', { room });
  });

  // --- leave (voluntary, playing → lobby) ---
  srv.on('leave', async (req) => {
    const { room } = req.data;
    await doLeave(req.user.id, room, srv);
  });

  // --- wsDisconnect (auto, grace period) ---
  srv.on('wsDisconnect', async (req) => {
    const user = req.user.id;
    for (const [roomId, r] of Object.entries(rooms)) {
      const isPlayer = r.players.X === user || r.players.O === user;
      const isSpectator = r.spectators.has(user);
      if (!isPlayer && !isSpectator) continue;

      if (isPlayer && ['playing'].includes(r.status)) {
        // grace period — pause, start timer
        const symbol = r.players.X === user ? 'X' : 'O';
        r.status = 'paused';
        const timer = setTimeout(() => doLeave(user, roomId, srv, true), GRACE_MS);
        r.disconnected.set(user, timer);
        const remaining = Object.keys(r.players).filter(s => r.players[s] !== user).length;
        await srv.emit('playerDisconnected', { room: roomId, player: user, symbol, remaining });
        LOG.info('DISCONNECT', roomId, user, symbol, '→ paused (grace 60s)');
      } else {
        // spectator or non-playing status → immediate leave
        await doLeave(user, roomId, srv);
      }
    }
  });

  // --- helpers ---

  async function doLeave(user, roomId, srv, fromTimeout = false) {
    const r = rooms[roomId];
    if (!r) return;

    // clear grace timer if exists
    if (r.disconnected.has(user)) {
      clearTimeout(r.disconnected.get(user));
      r.disconnected.delete(user);
    }

    const wasPlaying = ['playing', 'paused'].includes(r.status);
    const { symbol, newHost, deleted } = removePlayer(r, roomId, user);

    if (deleted) {
      await srv.emit('playerLeft', { room: roomId, player: user, symbol: symbol || 'spectator', newHost: '' });
      return;
    }

    if (wasPlaying) resetToLobby(r);

    await srv.emit('playerLeft', { room: roomId, player: user, symbol: symbol || 'spectator', newHost: newHost || '' });
    if (wasPlaying) await srv.emit('lobbyReset', { room: roomId });

    LOG.info(fromTimeout ? 'TIMEOUT' : 'LEAVE', roomId, user, symbol || 'spectator',
      newHost ? '→ newHost=' + newHost : '');
  }

  function error(req, room, message) {
    return srv.emit('gameError', { room: room || '', message });
  }
};


