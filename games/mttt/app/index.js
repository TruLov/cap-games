/**
 * Ultimate Tic-Tac-Toe UI — mount(rootEl, sdk) / renderSettings(el, sdk)
 *
 * Design ported from https://github.com/mschleeweiss/mttt by mschleeweiss
 * (Marc) — used with his permission. Thanks, Marc!
 */

const REPO_URL = 'https://github.com/mschleeweiss/mttt';

const STYLE = `
  .mt-credit { font-size: .75rem; color: var(--muted); margin-top: .75rem; }
  .mt-credit a { color: inherit; }
  .mt-teams { display: flex; gap: 1rem; margin: .75rem 0; }
  .mt-team { flex: 1; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .6rem; }
  .mt-team h4 { margin: 0 0 .4rem; }
  .mt-team ul { list-style: none; margin: 0 0 .5rem; padding: 0; font-size: .85rem; }
  /* aspect-ratio lives ONLY on the outermost grid — its height is then
     immediately derivable from its own width, so nothing below needs a
     second layout pass to converge (a chained aspect-ratio at every nesting
     level needs 2+ layout passes to settle, which read as "tiny until the
     first click" — whatever triggered the next reflow). Every level below
     just stretches to fill its known grid cell.
     #game-root (this mounts into it directly) is a column flexbox — a
     flex item's width normally comes from cross-axis stretch, which
     itself depends on layout being resolved first; combined with
     aspect-ratio that's a second, browser-quirky source of the same
     "needs an extra pass" problem, one level up. An explicit width (not
     max-width alone, which still leans on stretch to fill up to it)
     sidesteps that: the browser can compute it directly from CSS. */
  .mt-outer { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
              gap: 6px; width: min(420px, 100%); aspect-ratio: 1; margin: 0 auto; }
  .mt-inner { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
              gap: 2px; padding: 4px;
              border: 2px solid var(--border); border-radius: var(--radius-sm); }
  .mt-inner.active { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .mt-inner.preview-target { border-color: var(--success); box-shadow: 0 0 0 2px var(--success-soft); }
  .mt-inner.won-X, .mt-inner.won-O { opacity: .55; }
  .mt-inner.won-draw { opacity: .35; }
  .mt-cell { font-size: 1rem; font-weight: 700; padding: 0;
             background: var(--surface); color: var(--text); border: 1px solid var(--border); }
  .mt-cell:disabled { cursor: default; }
  .mt-board-winner { position: relative; }
  .mt-status { margin-bottom: .5rem; }
`;

function markOfUser(teams, user) {
  if (teams?.X?.includes(user)) return 'X';
  if (teams?.O?.includes(user)) return 'O';
  return null;
}

function creditFooter(sdk) {
  const el = document.createElement('div');
  el.className = 'mt-credit';
  el.innerHTML = `♟ Ultimate Tic-Tac-Toe design by <a href="${REPO_URL}" target="_blank" rel="noopener">mschleeweiss</a>`;
  el.querySelector('a').addEventListener('click', () => sdk.toast('Design by Marc — thanks! 🙌'));
  return el;
}

function renderTeamPanel(el, sdk, teams) {
  const myMark = markOfUser(teams, sdk.me.user);
  const listOf = mark => (teams[mark] ?? []).map(u => `<li>${sdk.nameOf(u)}${u === sdk.me.user ? ' (you)' : ''}</li>`).join('');

  el.querySelector('#mt-teams').innerHTML = `
    <div class="mt-team">
      <h4>Team X</h4>
      <ul>${listOf('X') || '<li class="sh-small">empty</li>'}</ul>
      <button class="sh-small" id="mt-join-x" ${myMark === 'X' ? 'disabled' : ''}>Join X</button>
    </div>
    <div class="mt-team">
      <h4>Team O</h4>
      <ul>${listOf('O') || '<li class="sh-small">empty</li>'}</ul>
      <button class="sh-small" id="mt-join-o" ${myMark === 'O' ? 'disabled' : ''}>Join O</button>
    </div>
  `;
  el.querySelector('#mt-join-x').addEventListener('click', () => sdk.send('chooseTeam', { room: sdk.room.id, team: 'X' }));
  el.querySelector('#mt-join-o').addEventListener('click', () => sdk.send('chooseTeam', { room: sdk.room.id, team: 'O' }));

  const leaveBtn = el.querySelector('#mt-leave');
  if (leaveBtn) leaveBtn.disabled = !myMark;
}

// Host-editable, read-only for everyone else — settings are locked once the
// host clicks Start, same as team picks.
function renderBlitzPanel(el, sdk, blitz) {
  const host = sdk.me.isHost;
  el.querySelector('#mt-blitz').innerHTML = `
    <label class="sh-small">
      <input type="checkbox" id="mt-blitz-enabled" ${blitz.enabled ? 'checked' : ''} ${host ? '' : 'disabled'}>
      Blitz — per-move timer
    </label>
    <input type="number" id="mt-blitz-seconds" value="${blitz.seconds}" min="5" max="120"
           style="width:4.5rem" ${host ? '' : 'disabled'}> sec/move
  `;
  if (!host) return;

  const send = () => {
    const enabled = el.querySelector('#mt-blitz-enabled').checked;
    const seconds = +el.querySelector('#mt-blitz-seconds').value;
    sdk.send('configureBlitz', { room: sdk.room.id, enabled, seconds });
  };
  el.querySelector('#mt-blitz-enabled').addEventListener('change', send);
  el.querySelector('#mt-blitz-seconds').addEventListener('change', send);
}

export default {
  // ---- pre-start: self-service team picking, live for everyone ----------
  renderSettings(el, sdk) {
    let teams = { X: [], O: [] };

    el.innerHTML = `
      <style>${STYLE}</style>
      <p class="sh-small">Pick a team — you can switch until the host starts.</p>
      <div id="mt-teams" class="mt-teams"></div>
      <div class="sh-row" id="mt-blitz"></div>
      <div class="sh-row" style="margin-top:.5rem">
        <button class="sh-small sh-ghost" id="mt-leave">Leave team</button>
        ${sdk.me.isHost ? '<button id="mt-start">Start game</button>' : ''}
      </div>
    `;
    renderTeamPanel(el, sdk, teams);
    renderBlitzPanel(el, sdk, { enabled: false, seconds: 30 });
    el.appendChild(creditFooter(sdk));

    el.querySelector('#mt-leave').addEventListener('click',
      () => sdk.send('chooseTeam', { room: sdk.room.id, team: 'none' }));
    el.querySelector('#mt-start')?.addEventListener('click', () => {
      if (!teams.X.length || !teams.O.length) {
        sdk.toast('Both teams need at least one player');
        return;
      }
      sdk.send('start', { room: sdk.room.id });
    });

    function onSettingsChanged({ teams: json, blitzEnabled, blitzSeconds }) {
      teams = JSON.parse(json);
      renderTeamPanel(el, sdk, teams);
      renderBlitzPanel(el, sdk, { enabled: blitzEnabled, seconds: blitzSeconds });
    }
    sdk.on('settingsChanged', onSettingsChanged);
    sdk.send('requestSettings', { room: sdk.room.id }); // prime the view with current state

    return () => { sdk.off('settingsChanged', onSettingsChanged); };
  },

  // ---- gameplay (mounted only once the match is starting/active) --------
  mount(rootEl, sdk) {
    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="mt-status" id="mt-status"><span id="mt-status-text"></span><span id="mt-clock"></span></div>
      <div class="mt-outer" id="mt-outer"></div>
    `;
    const statusEl = rootEl.querySelector('#mt-status-text');
    const outerEl  = rootEl.querySelector('#mt-outer');

    function setStatus(msg) { statusEl.textContent = msg; }

    // Rare flavor line on game over — a small nod to the game's designer.
    function winFlavor() {
      return Math.random() < (1 / 15) ? ' (Marc-approved victory 🎉)' : '';
    }

    // Purely a client-side display — the server enforces the actual skip
    // regardless of what this shows. Reset to a fresh deadline whenever a
    // new turn starts; cleared once the match ends.
    const clockEl = rootEl.querySelector('#mt-clock');
    let deadline = null;
    const clockInterval = setInterval(() => {
      if (!clockEl || deadline == null) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      clockEl.textContent = ` ⏱ ${remaining}s`;
    }, 250);

    function armClock(state) {
      if (!clockEl) return;
      if (state.winner || !state.blitz?.enabled) { deadline = null; clockEl.textContent = ''; return; }
      deadline = Date.now() + state.blitz.seconds * 1000;
    }

    function renderBoard(state) {
      const { cells, boardWinners, activeBoard, teams, turn, winner } = state;
      const myMark  = markOfUser(teams, sdk.me.user);
      const myTurn  = !winner && turn === sdk.me.user;

      outerEl.innerHTML = Array.from({ length: 9 }, (_, board) => {
        const bWin = boardWinners[board];
        const isActive = !winner && (activeBoard == null || activeBoard === board) && bWin == null;
        return `
          <div class="mt-inner${isActive ? ' active' : ''}${bWin ? ` won-${bWin}` : ''}" data-board="${board}">
            ${Array.from({ length: 9 }, (_, i) => {
              const idx = board * 9 + i;
              const mark = cells[idx];
              const open = !mark && !bWin && isActive && myTurn;
              return `<button class="mt-cell" data-cell="${idx}" ${open ? '' : 'disabled'}>${mark ?? ''}</button>`;
            }).join('')}
          </div>`;
      }).join('');

      outerEl.querySelectorAll('.mt-cell:not([disabled])').forEach(b => {
        const cell = +b.dataset.cell;
        b.addEventListener('click', () =>
          sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ cell }) }));

        // Preview which board this move sends the opponent to next — the
        // inner cell position (cell % 9) dictates the outer board, unless
        // that board is already decided, in which case they're free to
        // play anywhere (so every still-open board is highlighted instead).
        b.addEventListener('mouseenter', () => {
          const target = cell % 9;
          const targets = boardWinners[target] == null
            ? [target]
            : boardWinners.map((w, i) => (w == null ? i : null)).filter(i => i != null);
          for (const t of targets)
            outerEl.querySelector(`.mt-inner[data-board="${t}"]`)?.classList.add('preview-target');
        });
        b.addEventListener('mouseleave', () => {
          outerEl.querySelectorAll('.mt-inner.preview-target')
            .forEach(el => el.classList.remove('preview-target'));
        });
      });

      if (!myMark) setStatus('Spectating');
      else if (winner) setStatus(winner === 'draw' ? `Draw!${winFlavor()}` : `Team ${winner} wins!${winFlavor()}`);
      else setStatus(`Turn: ${sdk.nameOf(turn)} (Team ${markOfUser(teams, turn)})${myTurn ? ' — your move' : ''}`);
      armClock(state);
    }

    function onStarted({ state }) { renderBoard(JSON.parse(state)); }
    function onMoved({ data })    { renderBoard(JSON.parse(data)); }
    function onFinished({ state }) { renderBoard(JSON.parse(state)); }
    function onRematched({ state }) { renderBoard(JSON.parse(state)); }
    function onDisconnected({ player }) { setStatus(`${sdk.nameOf(player)} disconnected — waiting 60s…`); }
    function onReconnected({ player })  { setStatus(`${sdk.nameOf(player)} reconnected`); }

    sdk.on('started',            onStarted);
    sdk.on('moved',               onMoved);
    sdk.on('finished',            onFinished);
    sdk.on('rematched',           onRematched);
    sdk.on('playerDisconnected',  onDisconnected);
    sdk.on('playerReconnected',   onReconnected);

    setStatus('Loading…');
    rootEl.appendChild(creditFooter(sdk));

    return () => {
      clearInterval(clockInterval);
      sdk.off('started',            onStarted);
      sdk.off('moved',              onMoved);
      sdk.off('finished',           onFinished);
      sdk.off('rematched',          onRematched);
      sdk.off('playerDisconnected', onDisconnected);
      sdk.off('playerReconnected',  onReconnected);
    };
  },
};
