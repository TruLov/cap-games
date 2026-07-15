const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const winner = (b) => WIN_LINES.find(l => b[l[0]] && b[l[0]] === b[l[1]] && b[l[1]] === b[l[2]])?.[0];

module.exports = (srv) => {
  const rooms = {}; // { [room]: { board, players:{X,O}, turn, done } }

  srv.on('join', async (req) => {
    const { room } = req.data;
    const r = rooms[room] ??= { board: Array(9).fill(null), players: {}, turn: 'X', done: false };
    await req.context.ws.service.enter(room);
    let symbol = 'spectator';
    if      (!r.players.X)                              { r.players.X = req.user.id; symbol = 'X'; }
    else if (!r.players.O && r.players.X !== req.user.id) { r.players.O = req.user.id; symbol = 'O'; }
    await srv.emit('joined', { room, player: req.user.id, symbol });
    return symbol;
  });

  srv.on('move', async (req) => {
    const { room, cell } = req.data;
    const r = rooms[room];
    if (!r || r.done)          return srv.emit('error', { room, message: 'no active game' });
    const symbol = r.players.X === req.user.id ? 'X' : r.players.O === req.user.id ? 'O' : null;
    if (symbol !== r.turn)     return srv.emit('error', { room, message: 'not your turn' });
    if (r.board[cell] != null) return srv.emit('error', { room, message: 'cell taken' });
    r.board[cell] = symbol;
    r.turn = symbol === 'X' ? 'O' : 'X';
    const wi = winner(r.board);
    const full = r.board.every(Boolean);
    const board = JSON.stringify(r.board);
    if (wi != null || full) {
      r.done = true;
      await srv.emit('finished', { room, winner: wi != null ? r.board[wi] : 'draw', board });
    } else {
      await srv.emit('moved', { room, cell, symbol, board, nextTurn: r.turn });
    }
  });

  srv.on('leave', async (req) => {
    await req.context.ws.service.exit(req.data.room);
  });
};
