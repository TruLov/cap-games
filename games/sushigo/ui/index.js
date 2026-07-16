/**
 * Sushi Go Party! — Game UI. mount(rootEl, sdk)
 *
 * The game owns its whole UI area. It reuses shell components (chat, players)
 * via dynamic import, and drives the platform via sdk.send / sdk.on.
 *
 * Start flow: because the platform's init(settings) needs the player roster,
 * the host UI sends `configure` (menu preset + roster) and then `start`.
 * The generic host "Start" button is intentionally not used for lobby start.
 */

import { mountChat }    from '/shell/chat.js';
import { mountPlayers } from '/shell/players.js';

const MENU_PRESETS = [
  ['sushi_go',       'Sushi Go! (classic)'],
  ['my_first_meal',  'My First Meal'],
  ['party_sampler',  'Party Sampler'],
  ['master_menu',    'Master Menu'],
  ['points_platter', 'Points Platter'],
  ['cutthroat_combo','Cutthroat Combo'],
  ['big_banquet',    'Big Banquet'],
  ['dinner_for_two', 'Dinner for Two'],
];

const STYLE = `
  .sg-layout{display:flex;gap:1rem;align-items:flex-start}
  .sg-main{flex:1;min-width:0}
  .sg-aside{width:260px}
  .sg-status{font-weight:600;margin-bottom:.5rem}
  .sg-hand{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}
  .sg-card{border:1px solid #999;border-radius:8px;padding:.5rem .6rem;min-width:70px;
           background:#fff;cursor:default;font-size:.85rem;text-align:center}
  .sg-card.play{cursor:pointer;border-color:#2a7;box-shadow:0 1px 3px rgba(0,0,0,.15)}
  .sg-card.play:hover{background:#eafff2}
  .sg-card small{display:block;color:#666}
  .sg-tableau{display:grid;grid-template-columns:1fr;gap:.5rem;margin-top:.5rem}
  .sg-row{border:1px solid #ddd;border-radius:8px;padding:.4rem .6rem}
  .sg-row h4{margin:.1rem 0;display:flex;justify-content:space-between}
  .sg-played{display:flex;flex-wrap:wrap;gap:.25rem}
  .sg-chip{background:#f2f2f2;border-radius:6px;padding:.1rem .4rem;font-size:.75rem}
  .sg-menu select{padding:.3rem;margin-right:.5rem}
  .sg-waiting{color:#c60;font-style:italic}
`;

// short human label for a card
function cardLabel(c) {
  switch (c.type) {
    case 'nigiri':  return `Nigiri<small>${c.variant}${c.onWasabi ? ' ×3' : ''}</small>`;
    case 'maki':    return `Maki<small>${c.icons} icon${c.icons > 1 ? 's' : ''}</small>`;
    case 'uramaki': return `Uramaki<small>${c.icons} icons</small>`;
    case 'onigiri': return `Onigiri<small>${c.shape}</small>`;
    case 'fruit':   return `Fruit<small>${c.fruits.join('/')}</small>`;
    default:        return prettify(c.type);
  }
}
function prettify(t) { return t.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()); }

export default {
  mount(rootEl, sdk) {
    const me = sdk.me;
    const roster = new Set([me.symbol].filter(s => s && s !== 'spectator'));
    let state = null;

    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="sg-layout">
        <div class="sg-main">
          <div class="sg-status" id="sg-status"></div>
          <div id="sg-config"></div>
          <div id="sg-hand"></div>
          <div class="sg-tableau" id="sg-tableau"></div>
        </div>
        <aside class="sg-aside">
          <h3>Players</h3>
          <div id="sg-players"></div>
          <h3 style="margin-top:1rem">Chat</h3>
          <div id="sg-chat" style="height:240px"></div>
        </aside>
      </div>
    `;

    const $ = id => rootEl.querySelector(id);
    const statusEl = $('#sg-status');
    const setStatus = m => { statusEl.textContent = m; };

    const cleanupPlayers = mountPlayers($('#sg-players'), sdk, [me]);
    const cleanupChat    = mountChat($('#sg-chat'), sdk);

    // ---- lobby / config (host only) ------------------------------------
    function renderConfig() {
      const cfg = $('#sg-config');
      if (state) { cfg.innerHTML = ''; return; }
      if (!me.isHost) { cfg.innerHTML = '<p>Waiting for the host to start…</p>'; return; }
      cfg.innerHTML = `
        <div class="sg-menu">
          <label>Menu:
            <select id="sg-preset">
              ${MENU_PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </label>
          <button id="sg-start">Start game</button>
        </div>`;
      $('#sg-start').addEventListener('click', () => {
        const preset = $('#sg-preset').value;
        const players = [...roster];
        if (players.length < 2) { sdk.toast('Need at least 2 players'); return; }
        sdk.send('configure', { room: sdk.room.id, settings: JSON.stringify({ preset, players }) });
        sdk.send('start', { room: sdk.room.id });
      });
    }

    // ---- gameplay rendering --------------------------------------------
    function renderHand() {
      const el = $('#sg-hand');
      if (!state || state.phase !== 'playing') { el.innerHTML = ''; return; }
      const hand = state.hands?.[me.symbol] ?? [];
      const mine = Boolean(state.pending?.[me.symbol]);
      const waiting = Object.keys(state.pending ?? {}).length;
      el.innerHTML = `
        <div class="sg-status">Round ${state.round}/3 —
          ${mine ? `<span class="sg-waiting">selected, waiting for others (${waiting}/${state.symbols.length})</span>`
                 : 'pick a card to keep'}</div>
        <div class="sg-hand">
          ${hand.map((c, i) =>
            `<button class="sg-card ${mine ? '' : 'play'}" data-i="${i}" ${mine ? 'disabled' : ''}>${cardLabel(c)}</button>`
          ).join('')}
        </div>`;
      if (!mine) el.querySelectorAll('.sg-card.play').forEach(b =>
        b.addEventListener('click', () =>
          sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ pick: +b.dataset.i }) })));
    }

    function renderTableau() {
      const el = $('#sg-tableau');
      if (!state) { el.innerHTML = ''; return; }
      el.innerHTML = state.symbols.map(s => {
        const played = state.played?.[s] ?? [];
        const desserts = state.desserts?.[s] ?? [];
        const total = state.totals?.[s] ?? 0;
        const chips = [...played, ...desserts]
          .map(c => `<span class="sg-chip">${cardLabel(c).replace(/<[^>]+>/g, ' ').trim()}</span>`).join('');
        return `<div class="sg-row">
            <h4><span>${s}${s === me.symbol ? ' (you)' : ''}</span><span>${total} pts</span></h4>
            <div class="sg-played">${chips || '<em>—</em>'}</div>
          </div>`;
      }).join('');
    }

    function redraw() { renderConfig(); renderHand(); renderTableau(); }

    // ---- events ---------------------------------------------------------
    function onJoined(e) {
      if (e.symbol && e.symbol !== 'spectator') roster.add(e.symbol);
      renderConfig();
    }
    function onPlayerLeft(e) { roster.delete(e.symbol); renderConfig(); }
    function onStarted(e)  { state = JSON.parse(e.state); setStatus('Game started!'); redraw(); }
    function onMoved(e)    { state = JSON.parse(e.data); redraw(); }
    function onFinished(e) {
      state = JSON.parse(e.state);
      const r = state.ranking ?? [];
      const msg = e.winner === 'draw' ? 'Draw!' : `${e.winner} wins!`;
      setStatus(`Game over — ${msg}  [${r.map(x => `${x.symbol}:${x.score}`).join('  ')}]`);
      renderHand(); renderTableau();
    }
    function onLobbyReset() { state = null; setStatus('Back in lobby'); redraw(); }
    function onRematched(e) { state = JSON.parse(e.state); setStatus('Rematch!'); redraw(); }
    function onError(e)    { sdk.toast(e.message); }

    sdk.on('joined',     onJoined);
    sdk.on('playerLeft', onPlayerLeft);
    sdk.on('started',    onStarted);
    sdk.on('moved',      onMoved);
    sdk.on('finished',   onFinished);
    sdk.on('lobbyReset', onLobbyReset);
    sdk.on('rematched',  onRematched);
    sdk.on('gameError',  onError);

    setStatus(`You are ${me.symbol}${me.isHost ? ' (host)' : ''}`);
    redraw();

    // ---- cleanup --------------------------------------------------------
    return () => {
      cleanupPlayers?.();
      cleanupChat?.();
      sdk.off('joined',     onJoined);
      sdk.off('playerLeft', onPlayerLeft);
      sdk.off('started',    onStarted);
      sdk.off('moved',      onMoved);
      sdk.off('finished',   onFinished);
      sdk.off('lobbyReset', onLobbyReset);
      sdk.off('rematched',  onRematched);
      sdk.off('gameError',  onError);
    };
  }
};
