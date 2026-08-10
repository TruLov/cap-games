/**
 * Snake & Ladder UI — mount(rootEl, sdk)
 *
 * Mounted only once a match is starting/active. Players, chat and host controls
 * (start / rematch / back-to-room) live in the platform's room chrome, so this
 * game renders only the board + the roll action. No settingsSchema → no
 * renderSettings() (the platform's waiting room gives the host a Start button).
 *
 * The board is a pre-rendered PNG with a transparent <canvas> overlay for player
 * tokens — ported from the old standalone index.html, but state now arrives via
 * sdk.onState (the platform WS) instead of OData polling.
 */

// Adapted from the SAP CAP "July Developer Challenge — Snake & Ladder with
// status transition" tutorial by ajay_soreng. Credited in the UI footer.
const CREDIT_URL = 'https://community.sap.com/t5/sap-cap-blog-posts/july-developer-challenge-snake-amp-ladder-with-sap-cap-status-transition/ba-p/14429486';

const BOARD_SRC = new URL('./board.png', import.meta.url).href;
const PLAYER_COLORS = ['#E8106E', '#7B2FBE', '#0070F2', '#F97316'];
const SIZE = 520;
const CELL = SIZE / 10;

// Square number (1–100) → canvas centre, boustrophedon from bottom-left.
function cellXY(n) {
  const idx = n - 1, row = Math.floor(idx / 10), col = idx % 10;
  const bRow = 9 - row, bCol = row % 2 === 0 ? col : 9 - col;
  return { cx: bCol * CELL + CELL / 2, cy: bRow * CELL + CELL / 2 };
}

const initials = name => (name || '?').substring(0, 2).toUpperCase();

const EVENT_TEXT = {
  ladder:      to => `climbed a ladder to ${to} 🪜`,
  snake:       to => `hit a snake down to ${to} 🐍`,
  doubleSnake: to => `hit a double snake to ${to} 🐍🐍 — skips next turn`,
  overshoot:   () => `overshot 100 — no move`,
  win:         () => `reached 100 and wins! 🏆`,
  normal:      to => `moved to ${to}`,
};

const STYLE = `
  .sl-root { display: flex; flex-direction: column; gap: .75rem; color: var(--text); }
  .sl-status { min-height: 1.4rem; font-size: .95rem; color: var(--muted); }
  .sl-status b { color: var(--accent); }
  .sl-board-wrap { position: relative; width: min(${SIZE}px, 100%); margin: 0 auto; line-height: 0; }
  .sl-board-wrap img, .sl-board-wrap canvas {
    width: 100%; height: auto; display: block; border-radius: var(--radius-sm);
  }
  .sl-board-wrap canvas { position: absolute; inset: 0; pointer-events: none; }
  .sl-board-fallback { aspect-ratio: 1; background: #1D2D68; border: 2px dashed var(--border);
    border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center;
    color: var(--muted); font-size: .8rem; text-align: center; padding: 1rem; }
  .sl-controls { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
  .sl-roll { font-size: 1rem; font-weight: 600; padding: .5rem 1.1rem; }
  .sl-players { display: flex; flex-direction: column; gap: .35rem; }
  .sl-player { display: flex; align-items: center; gap: .6rem; padding: .35rem .5rem;
    border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--border); }
  .sl-player.turn { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .sl-avatar { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: flex;
    align-items: center; justify-content: center; font-weight: 700; font-size: .72rem; color: #fff; }
  .sl-pinfo { flex: 1; min-width: 0; }
  .sl-pname { font-size: .88rem; font-weight: 600; }
  .sl-ppos  { font-size: .72rem; color: var(--muted); }
  .sl-badge { font-size: .66rem; font-weight: 700; padding: 2px 8px; border-radius: 10px;
    white-space: nowrap; background: var(--surface-hover); color: var(--muted); }
  .sl-badge.win { background: var(--success-soft); color: var(--success); }
  .sl-badge.blocked { background: rgba(232,16,110,.25); color: #ffaacc; }
  .sl-credit { margin-top: .5rem; font-size: .72rem; color: var(--muted); }
  .sl-credit a { color: var(--accent); }
`;

export default {
  mount(rootEl, sdk) {
    rootEl.classList.add('sl-root');
    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="sl-status" id="sl-status">Loading…</div>
      <div class="sl-board-wrap" id="sl-board-wrap">
        <img id="sl-img" alt="Snake &amp; Ladder board">
        <canvas id="sl-canvas" width="${SIZE}" height="${SIZE}"></canvas>
      </div>
      <div class="sl-controls">
        <button class="sl-roll" id="sl-roll" disabled>🎲 Roll dice</button>
        <span class="sl-status" id="sl-last"></span>
      </div>
      <div class="sl-players" id="sl-players"></div>
      <div class="sl-credit">🐍 Based on the <a href="${CREDIT_URL}" target="_blank" rel="noopener">SAP CAP July Developer Challenge</a> by ajay_soreng.</div>
    `;

    const statusEl  = rootEl.querySelector('#sl-status');
    const lastEl    = rootEl.querySelector('#sl-last');
    const rollBtn   = rootEl.querySelector('#sl-roll');
    const playersEl = rootEl.querySelector('#sl-players');
    const canvas    = rootEl.querySelector('#sl-canvas');
    const img       = rootEl.querySelector('#sl-img');
    const ctx       = canvas.getContext('2d');

    img.src = BOARD_SRC;
    img.onerror = () => {
      img.remove();
      const fb = document.createElement('div');
      fb.className = 'sl-board-fallback';
      fb.textContent = 'board.png not found';
      rootEl.querySelector('#sl-board-wrap').prepend(fb);
    };

    const colorOf = (order, user) => PLAYER_COLORS[order.indexOf(user) % PLAYER_COLORS.length];

    function drawTokens(state) {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const { order, positions } = state;
      const bySquare = {};
      for (const u of order) (bySquare[positions[u]] ??= []).push(u);

      for (const [sq, users] of Object.entries(bySquare)) {
        const offs = users.length === 1 ? [0]
          : users.length === 2 ? [-11, 11]
          : users.length === 3 ? [-14, 0, 14] : [-16, -6, 6, 16];
        users.forEach((u, i) => {
          const { cx, cy } = cellXY(Number(sq));
          const x = cx + (offs[i] || 0), y = cy + CELL * 0.12;
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
          ctx.fillStyle = colorOf(order, u);
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, CELL * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = '#fff';
          ctx.font = `bold ${CELL * 0.14}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(initials(sdk.nameOf(u)), x, y);
        });
      }
    }

    function renderPlayers(state) {
      const { order, positions, turn, winner, blocked } = state;
      playersEl.innerHTML = order.map(u => {
        const isTurn = !winner && u === turn;
        const badge = u === winner ? '<span class="sl-badge win">🏆 Winner</span>'
          : blocked[u] ? '<span class="sl-badge blocked">Skips next</span>'
          : isTurn ? '<span class="sl-badge">Rolling</span>' : '';
        const av = sdk.avatarUrl(u);
        return `
          <div class="sl-player${isTurn ? ' turn' : ''}">
            <div class="sl-avatar" style="background:${colorOf(order, u)}${av ? `;background-image:url('${av}');background-size:cover;background-position:center` : ''}">${av ? '' : initials(sdk.nameOf(u))}</div>
            <div class="sl-pinfo">
              <div class="sl-pname">${sdk.nameOf(u)}${u === sdk.me.user ? ' (you)' : ''}</div>
              <div class="sl-ppos">Square ${positions[u]}</div>
            </div>
            ${badge}
          </div>`;
      }).join('');
    }

    function render(state) {
      drawTokens(state);
      renderPlayers(state);

      const { turn, winner, lastMove } = state;
      const myTurn = !winner && turn === sdk.me.user && !sdk.me.spectator;
      rollBtn.disabled = !myTurn;

      if (winner) {
        statusEl.innerHTML = winner === sdk.me.user
          ? '<b>You win!</b> 🏆' : `<b>${sdk.nameOf(winner)}</b> wins! 🏆`;
      } else if (sdk.me.spectator) {
        statusEl.innerHTML = `Turn: <b>${sdk.nameOf(turn)}</b> (spectating)`;
      } else {
        statusEl.innerHTML = myTurn ? '<b>Your turn</b> — roll the dice!'
          : `Waiting for <b>${sdk.nameOf(turn)}</b>…`;
      }

      if (lastMove) {
        const desc = (EVENT_TEXT[lastMove.event] ?? EVENT_TEXT.normal)(lastMove.to);
        lastEl.textContent = `${sdk.nameOf(lastMove.user)} rolled ${lastMove.roll} — ${desc}`;
      }
    }

    rollBtn.addEventListener('click', () => {
      if (rollBtn.disabled) return;
      rollBtn.disabled = true;   // optimistic; re-enabled by the next state if still our turn
      sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ type: 'roll' }) });
    });

    const stopState = sdk.onState(state => render(state));
    const onError = ({ message }) => sdk.toast(message);
    sdk.onError(onError);

    return () => { stopState(); sdk.off('gameError', onError); };
  },
};
