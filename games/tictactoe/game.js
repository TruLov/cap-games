/**
 * TicTacToe - pure game module (platform hook contract).
 *
 * Implements meta, settingsSchema, init, applyMove; score is omitted so the
 * platform's defaultScore is used (W:3 D:1 L:0), and extendService is omitted
 * (no game-specific actions needed). Pure logic - no CAP imports. Registered
 * with the platform by ./cds-plugin.js.
 *
 * The platform identifies players by `user` and assigns no symbols. X/O are a
 * tic-tac-toe concern: init() maps the two players (host first) to marks and
 * keeps that map in `state.marks`; turns/winner are reported back as `user` ids.
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
  return line ? board[line[0]] : null;   // returns the winning MARK ('X'/'O')
}

export default {

  meta: {
    name:       'TicTacToe',
    minPlayers: 2,
    maxPlayers: 2,
    help: 'The classic, for 2 players. Take turns placing your mark (X or O) on the 3x3 grid. First to line up three marks in a row, column, or diagonal wins. If the board fills up with no winner, it is a draw.',
    gallery: ['gallery/cover-1.svg', 'gallery/cover-2.svg'],
  },

  settingsSchema: {
    // which MARK moves first (X = the host by convention)
    firstPlayer: { type: 'enum', values: ['X', 'O', 'random'], default: 'X' },
  },

  // Game-declared achievements - SINGLE-MATCH, pure. Aggregate feats (streaks,
  // totals) are the platform's job (srv/achievements.js), not a game's.
  achievements: {
    underdog: { name: 'Underdog', desc: 'Win a match as O (the second player)' },
  },

  // Return the ids THIS user earned in THIS finished match. Pure & synchronous;
  // reads only the final state + end, never any history.
  checkAchievements(end, state, user) {
    const earned = [];
    if (end.winner === user && state.marks?.[user] === 'O') earned.push('underdog');
    return earned;
  },

  init(settings = {}, players = []) {
    // player 0 (host) is X, player 1 is O - the platform passes them ordered
    const marks = {};
    if (players[0]) marks[players[0].user] = 'X';
    if (players[1]) marks[players[1].user] = 'O';
    const userForMark = m => Object.keys(marks).find(u => marks[u] === m);

    let firstMark = settings.firstPlayer ?? 'X';
    if (firstMark === 'random') firstMark = Math.random() < 0.5 ? 'X' : 'O';

    return { board: Array(9).fill(null), turn: userForMark(firstMark), marks };
  },

  applyMove(state, move, user) {
    const { board, turn, marks } = state;
    const { cell } = move;

    if (user !== turn)
      return { error: 'not your turn' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 8)
      return { error: 'invalid cell' };
    if (board[cell] != null)
      return { error: 'cell taken' };

    const newBoard = [...board];
    newBoard[cell] = marks[user];
    const winnerMark = checkWinner(newBoard);
    const full = newBoard.every(Boolean);
    const newTurn = Object.keys(marks).find(u => u !== turn);   // the other player
    const winnerUser = winnerMark && Object.keys(marks).find(u => marks[u] === winnerMark);

    return {
      state: { board: newBoard, turn: newTurn, marks },
      end: (winnerMark || full) ? { winner: winnerUser ?? 'draw' } : null,
    };
  },
};
