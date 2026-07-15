/**
 * TicTacToe game module
 *
 * Game interface (cap-games platform):
 *   meta, settingsSchema, init(settings), applyMove(state, move, symbol)
 *   score?(end, players)   — omitted: platform defaultScore is used (W:3 D:1 L:0)
 *   extendService?(srv)    — omitted: no game-specific actions needed
 */

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],   // rows
  [0,3,6],[1,4,7],[2,5,8],   // cols
  [0,4,8],[2,4,6],           // diagonals
];

function checkWinner(board) {
  const line = WIN_LINES.find(
    l => board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]
  );
  return line ? board[line[0]] : null;
}

module.exports = {

  meta: {
    name:       'TicTacToe',
    minPlayers: 2,
    maxPlayers: 2,
  },

  settingsSchema: {
    firstPlayer: { type: 'enum', values: ['X', 'O', 'random'], default: 'X' },
  },

  init(settings = {}) {
    let turn = settings.firstPlayer ?? 'X';
    if (turn === 'random') turn = Math.random() < 0.5 ? 'X' : 'O';
    return { board: Array(9).fill(null), turn };
  },

  applyMove(state, move, symbol) {
    const { board, turn } = state;
    const { cell } = move;

    if (symbol !== turn)
      return { error: 'not your turn' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 8)
      return { error: 'invalid cell' };
    if (board[cell] != null)
      return { error: 'cell taken' };

    const newBoard = [...board];
    newBoard[cell] = symbol;
    const winner = checkWinner(newBoard);
    const full = newBoard.every(Boolean);
    const newTurn = turn === 'X' ? 'O' : 'X';

    return {
      state: { board: newBoard, turn: newTurn },
      end: (winner || full) ? { winner: winner ?? 'draw' } : null,
    };
  },
};
