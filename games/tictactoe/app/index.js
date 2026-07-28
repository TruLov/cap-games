/**
 * TicTacToe UI — mount(rootEl, sdk)
 *
 * Game controls its entire layout.
 * Uses shell components (chat, players, host-controls) optionally via DI.
 */
import { mountChat }         from '/shell/chat.js';
import { mountPlayers }      from '/shell/players.js';
import { mountHostControls } from '/shell/host.js';

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

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
    // ── Build layout ──────────────────────────────────────
    rootEl.innerHTML = `
      <div class="gm-layout">
        <div class="gm-main">
          <div class="ttt-status" id="ttt-status"></div>
          <div class="ttt-board-wrap" id="ttt-board"></div>
          <div id="ttt-host"></div>
        </div>
        <aside class="gm-aside">
          <h3>Players</h3>
          <div id="ttt-players"></div>
          <h3 style="margin-top:1rem">Chat</h3>
          <div id="ttt-chat" style="height:260px"></div>
        </aside>
      </div>
    `;

    const statusEl = rootEl.querySelector('#ttt-status');
    const boardEl  = rootEl.querySelector('#ttt-board');

    // ── Mount shell components (optional DI) ──────────────
    const cleanupPlayers = mountPlayers(
      rootEl.querySelector('#ttt-players'), sdk, [sdk.me]);
    const cleanupChat    = mountChat(
      rootEl.querySelector('#ttt-chat'), sdk);
    const cleanupHost    = mountHostControls(
      rootEl.querySelector('#ttt-host'), sdk, 'lobby');

    // ── Game event handlers ───────────────────────────────
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

    function onRoomReset() {
      setStatus('Back in the room — waiting for players');
      boardEl.innerHTML = '';
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
    sdk.on('roomReset',        onRoomReset);
    sdk.on('playerDisconnected', onDisconnected);
    sdk.on('playerReconnected',  onReconnected);

    // host is X, the other player is O (marks are seat-based)
    setStatus(`You are ${sdk.me.isHost ? 'X (host)' : 'O'} — waiting…`);

    // ── Unmount cleanup ───────────────────────────────────
    return () => {
      cleanupPlayers?.();
      cleanupChat?.();
      cleanupHost?.();
      sdk.off('started',            onStarted);
      sdk.off('moved',              onMoved);
      sdk.off('finished',           onFinished);
      sdk.off('rematched',          onRematched);
      sdk.off('roomReset',         onRoomReset);
      sdk.off('playerDisconnected', onDisconnected);
      sdk.off('playerReconnected',  onReconnected);
    };
  }
};
