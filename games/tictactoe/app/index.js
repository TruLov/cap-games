/**
 * TicTacToe UI — mount(rootEl, sdk)
 *
 * Called only once a match is actually starting/active (or reconnecting into
 * one) — players, chat and host controls (start/switch-game/rematch/back-to-
 * room) all live in the platform's persistent room chrome, so this game only
 * ever renders the board. No settingsSchema, so no renderSettings() either.
 */

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

// Self-contained board styling — borrows the shell's design tokens
// (var(--accent) etc., still available as inherited custom properties)
// rather than a from-scratch palette, but owns its own rules so it isn't
// relying on the shared stylesheet.
const STYLE = `
  .ttt-board {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 6px; max-width: 300px;
  }
  .ttt-cell {
    aspect-ratio: 1; font-size: 2rem; font-weight: bold;
    border-radius: var(--radius-sm); background: var(--surface);
    backdrop-filter: blur(var(--glass-blur)) saturate(120%);
    border: 2px solid var(--border); color: var(--text);
    transition: background var(--transition);
  }
  .ttt-cell.open       { border-color: var(--accent); }
  .ttt-cell.open:hover { background: var(--surface-hover); }
  .ttt-cell.win        { border-color: var(--success); background: var(--success-soft); color: var(--success); }
  .ttt-status { font-size: 1rem; color: var(--muted); min-height: 1.4rem; }
  .ttt-board-wrap { flex: 1; }
`;

function winLine(board) {
  return WIN_LINES.find(
    l => board[l[0]] && board[l[0]] === board[l[1]] && board[l[1]] === board[l[2]]
  );
}

// Turn/winner arrive as `user` ids; tic-tac-toe shows its own X/O marks.
const markOf = (state, userId) => state?.marks?.[userId] ?? userId;

function renderBoard(state, boardEl, sdk) {
  const { board, turn } = state;
  const line   = winLine(board);
  const done   = !!line || board.every(Boolean);
  const myTurn = !done && turn === sdk.me.user;

  boardEl.innerHTML = `
    <div class="ttt-board">
      ${board.map((cell, i) => {
        const win  = line?.includes(i) ? ' win' : '';
        const open = !cell && myTurn ? ' open' : '';
        return `<button class="ttt-cell${win}${open}"
                        data-cell="${i}"
                        ${cell || !myTurn || done ? 'disabled' : ''}
                >${cell ?? ''}</button>`;
      }).join('')}
    </div>
  `;

  boardEl.querySelectorAll('.ttt-cell.open').forEach(b =>
    b.addEventListener('click', () =>
      sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ cell: +b.dataset.cell }) })
    ));
}

export default {
  mount(rootEl, sdk) {
    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="ttt-status" id="ttt-status"></div>
      <div class="ttt-board-wrap" id="ttt-board"></div>
    `;

    const statusEl = rootEl.querySelector('#ttt-status');
    const boardEl  = rootEl.querySelector('#ttt-board');

    function setStatus(msg) { statusEl.textContent = msg; }

    function onStarted({ firstTurn, state }) {
      const s = JSON.parse(state);
      setStatus(`Playing — ${markOf(s, firstTurn)} goes first`);
      renderBoard(s, boardEl, sdk);
    }

    function onMoved({ data }) {
      const s = JSON.parse(data);
      setStatus(`Turn: ${markOf(s, s.turn)}`);
      renderBoard(s, boardEl, sdk);
    }

    function onFinished({ winner, state }) {
      const s = JSON.parse(state);
      const msg = winner === 'draw' ? 'Draw!' : `${markOf(s, winner)} wins!`;
      setStatus(`Game over — ${msg}`);
      renderBoard(s, boardEl, sdk);
    }

    function onRematched({ firstTurn, state }) {
      const s = JSON.parse(state);
      setStatus(`Rematch — ${markOf(s, firstTurn)} goes first`);
      renderBoard(s, boardEl, sdk);
    }

    function onDisconnected({ player }) {
      setStatus(`${player} disconnected — waiting 60s…`);
    }

    function onReconnected({ player }) {
      setStatus(`${player} reconnected`);
    }

    sdk.on('started',           onStarted);
    sdk.on('moved',             onMoved);
    sdk.on('finished',          onFinished);
    sdk.on('rematched',         onRematched);
    sdk.on('playerDisconnected', onDisconnected);
    sdk.on('playerReconnected',  onReconnected);

    setStatus('Loading…');

    return () => {
      sdk.off('started',            onStarted);
      sdk.off('moved',              onMoved);
      sdk.off('finished',           onFinished);
      sdk.off('rematched',          onRematched);
      sdk.off('playerDisconnected', onDisconnected);
      sdk.off('playerReconnected',  onReconnected);
    };
  }
};
