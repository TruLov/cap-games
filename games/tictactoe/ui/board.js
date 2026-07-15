/* TicTacToe board UI module
 * Interface: render(state, el, { onMove })
 * state = { board: Array(9), turn: 'X'|'O' }
 */

const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function winLine(board) {
  return WINS.find(l => board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]);
}

export default {
  render(state, el, { onMove, mySymbol }) {
    const { board, turn } = state;
    const line = winLine(board);
    const done = !!line || board.every(Boolean);
    const myTurn = !done && turn === mySymbol;

    el.innerHTML = `
      <div class="ttt-board" data-done="${done}">
        ${board.map((cell, i) => {
          const win  = line?.includes(i) ? ' win' : '';
          const open = !cell && myTurn ? ' open' : '';
          return `<button class="ttt-cell${win}${open}"
                          data-cell="${i}"
                          ${cell || !myTurn || done ? 'disabled' : ''}>${cell ?? ''}</button>`;
        }).join('')}
      </div>
    `;

    el.querySelectorAll('.ttt-cell.open').forEach(b =>
      b.addEventListener('click', () => onMove({ cell: +b.dataset.cell })));
  }
};
