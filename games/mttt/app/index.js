/**
 * Ultimate Tic-Tac-Toe UI — mount(rootEl, sdk) / renderSettings(el, sdk)
 *
 * Design ported from https://github.com/mschleeweiss/mttt by mschleeweiss
 * (Marc) — used with his permission. Thanks, Marc!
 */

const REPO_URL = 'https://github.com/mschleeweiss/mttt';

/* Self-contained Tokyo-neon skin, independent of the shell's gunmetal
   theme — this board is meant to read like a night-market arcade cabinet,
   so it hardcodes its own cyan/magenta/violet palette rather than
   inheriting the shell's var(--accent) etc. */
const STYLE = `
  .mt-root {
    --mt-cyan: #00f0ff; --mt-cyan-soft: rgba(0,240,255,.25);
    --mt-pink: #ff2fd8; --mt-pink-soft: rgba(255,47,216,.25);
    --mt-violet: #8b2fff; --mt-violet-soft: rgba(139,47,255,.22);
    --mt-void: #07030f;
  }
  .mt-credit { font-family: var(--font-mono); font-size: .72rem; color: #9a8fc2; margin-top: .75rem; letter-spacing: .02em; }
  .mt-credit a { color: var(--mt-cyan); }
  .mt-teams { display: flex; gap: 1rem; margin: .75rem 0; }
  .mt-team { flex: 1; border: 1px solid rgba(139,47,255,.35); border-radius: var(--radius-sm); padding: .6rem;
             background: linear-gradient(160deg, rgba(139,47,255,.08), rgba(7,3,15,.4)); }
  .mt-team h4 { margin: 0 0 .4rem; font-family: var(--font-mono); font-size: .78rem;
                text-transform: uppercase; letter-spacing: .1em; color: var(--mt-cyan);
                text-shadow: 0 0 6px var(--mt-cyan-soft); }
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
              gap: 8px; width: min(420px, 100%); aspect-ratio: 1; margin: 0 auto;
              padding: 8px; border-radius: var(--radius);
              background: var(--mt-void);
              border: 1px solid var(--mt-violet-soft);
              box-shadow: 0 0 30px var(--mt-violet-soft), inset 0 0 20px rgba(139,47,255,.08); }
  .mt-inner { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(3, 1fr);
              gap: 2px; padding: 4px;
              background: rgba(139,47,255,.05);
              border: 1px solid rgba(139,47,255,.3); border-radius: var(--radius-sm);
              transition: border-color var(--transition), box-shadow var(--transition), opacity var(--transition); }
  .mt-inner.active { border-color: var(--mt-cyan); box-shadow: 0 0 14px var(--mt-cyan-soft), inset 0 0 10px var(--mt-cyan-soft);
                      animation: mt-pulse 1.6s ease-in-out infinite; }
  .mt-inner.preview-target { border-color: var(--mt-pink); box-shadow: 0 0 14px var(--mt-pink-soft), inset 0 0 10px var(--mt-pink-soft); }
  .mt-inner.won-X, .mt-inner.won-O { opacity: .55; animation: none; }
  .mt-inner.won-draw { opacity: .25; animation: none; }
  /* Big mark layered over a won sub-board — the grid of small cell marks
     stays visible underneath (dimmed via won-X/won-O above). */
  .mt-board-mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                    font-family: var(--font-mono); font-weight: 900; font-size: 3.2rem; line-height: 1;
                    pointer-events: none; }
  .mt-board-mark-X { color: var(--mt-cyan); text-shadow: 0 0 14px var(--mt-cyan), 0 0 30px var(--mt-cyan-soft); }
  .mt-board-mark-O { color: var(--mt-pink); text-shadow: 0 0 14px var(--mt-pink), 0 0 30px var(--mt-pink-soft); }
  @keyframes mt-pulse {
    0%, 100% { box-shadow: 0 0 10px var(--mt-cyan-soft), inset 0 0 6px var(--mt-cyan-soft); }
    50%      { box-shadow: 0 0 20px var(--mt-cyan-soft), inset 0 0 14px var(--mt-cyan-soft); }
  }
  .mt-cell { font-family: var(--font-mono); font-size: 1.1rem; font-weight: 700; padding: 0;
             background: rgba(255,255,255,.02); color: var(--mt-cyan); border: 1px solid rgba(139,47,255,.25);
             border-radius: 2px; clip-path: none;
             transition: background var(--transition), border-color var(--transition); }
  .mt-cell::before, .mt-cell::after { content: none; }
  .mt-cell.mt-mark-X { color: var(--mt-cyan); text-shadow: 0 0 8px var(--mt-cyan), 0 0 16px var(--mt-cyan-soft); }
  .mt-cell.mt-mark-O { color: var(--mt-pink); text-shadow: 0 0 8px var(--mt-pink), 0 0 16px var(--mt-pink-soft); }
  .mt-cell:not(:disabled):hover { background: rgba(0,240,255,.08); border-color: var(--mt-cyan); }
  .mt-cell:disabled { cursor: default; }
  .mt-status { margin-bottom: .5rem; font-family: var(--font-mono); letter-spacing: .02em; color: #d8cfff; }
  .mt-status #mt-clock { color: var(--mt-pink); text-shadow: 0 0 8px var(--mt-pink-soft); }

  /* Match-over screen — winner banner + final team rosters, shown under
     the board once state.winner is set (started/moved/finished/rematched
     all funnel through renderBoard → renderResults). */
  .mt-results { margin-top: 1rem; }
  .mt-banner  { font-family: var(--font-mono); font-size: 1.3rem; font-weight: 700;
                letter-spacing: .03em; color: var(--mt-cyan);
                text-shadow: 0 0 10px var(--mt-cyan-soft); margin-bottom: .5rem; }
  .mt-team.mt-team-winner { border-color: var(--mt-cyan); box-shadow: 0 0 16px var(--mt-cyan-soft); }
  .mt-team.mt-team-winner h4 { color: var(--mt-pink); text-shadow: 0 0 6px var(--mt-pink-soft); }
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

    el.classList.add('mt-root');
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
    rootEl.classList.add('mt-root');
    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="mt-status" id="mt-status"><span id="mt-status-text"></span><span id="mt-clock"></span></div>
      <div class="mt-outer" id="mt-outer"></div>
      <div class="mt-results" id="mt-results"></div>
    `;
    const statusEl  = rootEl.querySelector('#mt-status-text');
    const outerEl   = rootEl.querySelector('#mt-outer');
    const resultsEl = rootEl.querySelector('#mt-results');

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
            ${bWin === 'X' || bWin === 'O' ? `<span class="mt-board-mark mt-board-mark-${bWin}">${bWin}</span>` : ''}
            ${Array.from({ length: 9 }, (_, i) => {
              const idx = board * 9 + i;
              const mark = cells[idx];
              const open = !mark && !bWin && isActive && myTurn;
              return `<button class="mt-cell${mark ? ` mt-mark-${mark}` : ''}" data-cell="${idx}" ${open ? '' : 'disabled'}>${mark ?? ''}</button>`;
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

      const winMsg = winner ? (winner === 'draw' ? `Draw!${winFlavor()}` : `Team ${winner} wins!${winFlavor()}`) : '';
      if (!myMark) setStatus('Spectating');
      else if (winner) setStatus(winMsg);
      else setStatus(`Turn: ${sdk.nameOf(turn)} (Team ${markOfUser(teams, turn)})${myTurn ? ' — your move' : ''}`);
      armClock(state);
      renderResults(winner, teams, winMsg);
    }

    // Match-over screen — winner banner + final team rosters. Cleared
    // automatically on a fresh match/rematch (winner is null again).
    function renderResults(winner, teams, winMsg) {
      if (!winner) { resultsEl.innerHTML = ''; return; }
      const listOf = mark => (teams[mark] ?? [])
        .map(u => `<li>${sdk.nameOf(u)}${u === sdk.me.user ? ' (you)' : ''}</li>`).join('')
        || '<li class="sh-small">empty</li>';
      resultsEl.innerHTML = `
        <div class="mt-banner">${winMsg}</div>
        <div class="mt-teams">
          <div class="mt-team${winner === 'X' ? ' mt-team-winner' : ''}"><h4>Team X</h4><ul>${listOf('X')}</ul></div>
          <div class="mt-team${winner === 'O' ? ' mt-team-winner' : ''}"><h4>Team O</h4><ul>${listOf('O')}</ul></div>
        </div>`;
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
