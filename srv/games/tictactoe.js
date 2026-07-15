/**
 * TicTacToe game module
 *
 * Interface contract (required by engine):
 *   minPlayers : Number
 *   maxPlayers : Number
 *   init()     : Object  — fresh game state
 *   applyMove(state, move, symbol) : { state, end: null | { winner: 'X'|'O'|'draw' } }
 *
 * move = { cell: 0..8 }
 * state = { board: Array(9), turn: 'X'|'O' }
 */

const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkWinner(board) {
  const line = WIN_LINES.find(l => board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]);
  return line ? board[line[0]] : null;
}

module.exports = {
  minPlayers: 2,
  maxPlayers: 2,

  init() {
    return { board: Array(9).fill(null), turn: 'X' };
  },

  applyMove(state, move, symbol) {
    const { board, turn } = state;
    const cell = move.cell;

    if (symbol !== turn)          return { error: 'not your turn' };
    if (!Number.isInteger(cell) ||
        cell < 0 || cell > 8)     return { error: 'invalid cell' };
    if (board[cell] != null)      return { error: 'cell taken' };

    const newBoard = [...board];
    newBoard[cell] = symbol;
    const winner = checkWinner(newBoard);
    const full = newBoard.every(Boolean);

    return {
      state: { board: newBoard, turn: turn === 'X' ? 'O' : 'X' },
      end: (winner || full) ? { winner: winner || 'draw' } : null,
    };
  },
};
