/**
 * Kaiten — Game UI. mount(rootEl, sdk)
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
  ['classic',        'Kaiten (classic)'],
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
  .sg-aside{width:280px}
  .sg-status{font-weight:600;margin-bottom:.5rem}
  .sg-hand{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}
  .sg-card{border:1px solid #999;border-radius:8px;padding:.5rem .6rem;min-width:70px;
           background:#fff;color:#222;cursor:default;font-size:.85rem;text-align:center}
  .sg-card.play{cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15)}
  .sg-card.play:hover{box-shadow:0 2px 8px rgba(0,0,0,.3);filter:brightness(1.04)}
  .sg-card small{display:block;color:#555}
  .sg-tableau{display:grid;grid-template-columns:1fr;gap:.5rem;margin-top:.5rem}
  .sg-row{border:1px solid #ddd;border-radius:8px;padding:.4rem .6rem}
  .sg-row h4{margin:.1rem 0;display:flex;justify-content:space-between}
  .sg-played{display:flex;flex-wrap:wrap;gap:.25rem}
  .sg-chip{background:#f2f2f2;color:#222;border:1px solid #ccc;border-radius:6px;padding:.1rem .4rem;font-size:.75rem}
  .sg-chop-chip{background:#e8f4ff;color:#1a4d80;border:1px solid #7ab4e0;cursor:pointer;font-size:.75rem;
                border-radius:6px;padding:.1rem .4rem}
  .sg-chop-chip:hover{background:#d4ebff}
  .sg-chop-chip.active{background:#2266cc;color:#fff;border-color:#2266cc}
  .sg-menu select{padding:.3rem;margin-right:.5rem}
  .sg-waiting{color:#c60;font-style:italic}
  .sg-spoon{margin:.3rem 0;font-size:.85rem;background:#fff8e6;border:1px solid #e5c86a;border-radius:6px;padding:.35rem .5rem}
  .sg-chopsticks{margin:.3rem 0;font-size:.85rem;background:#e8f4ff;border:1px solid #7ab4e0;border-radius:6px;padding:.35rem .5rem}
  .sg-card.selected{border-color:#2266cc;background:#ddeeff;box-shadow:0 0 0 2px #2266cc55}
  .sg-score-table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:.4rem}
  .sg-score-table th,.sg-score-table td{padding:.2rem .35rem;text-align:center;border:1px solid #ddd;color:#222}
  .sg-score-table th{background:#f5f5f5;font-weight:600}
  .sg-score-table tr.me td{background:#fffce0}
  .sg-score-table td.total{font-weight:700}
  .sg-history-details{font-size:.75rem;color:#555;margin:.15rem 0}
  .sg-history-details summary{cursor:pointer;color:#448;user-select:none}
  .sg-history-chips{display:flex;flex-wrap:wrap;gap:.2rem;margin-top:.2rem}
  .sg-history-chip{background:#e8e8e8;color:#333;border:1px solid #ccc;border-radius:4px;padding:.1rem .3rem}
  .sg-results{margin-top:1rem;border:2px solid #2a7;border-radius:8px;padding:.8rem}
  .sg-results table{width:100%;border-collapse:collapse;font-size:.88rem}
  .sg-results th,.sg-results td{padding:.3rem .5rem;text-align:right;border-bottom:1px solid #eee;color:#222}
  .sg-results th:first-child,.sg-results td:first-child{text-align:left}
  .sg-results tr.winner td{font-weight:700;color:#1a7}
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
function cardText(c) {
  switch (c.type) {
    case 'nigiri':  return `Nigiri (${c.variant}${c.onWasabi ? ' ×3' : ''})`;
    case 'maki':    return `Maki ×${c.icons}`;
    case 'uramaki': return `Uramaki ×${c.icons}`;
    case 'onigiri': return `Onigiri (${c.shape})`;
    case 'fruit':   return `Fruit (${c.fruits.join('/')})`;
    default:        return prettify(c.type);
  }
}
function prettify(t) { return t.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()); }

// Per-type colouring: each card type gets a distinct, evenly-spaced hue so it's
// easy to see at a glance how many of each kind a player has collected.
const CARD_ORDER = [
  'nigiri', 'maki', 'temaki', 'uramaki',
  'tempura', 'sashimi', 'dumpling', 'eel', 'tofu', 'onigiri', 'edamame', 'miso',
  'chopsticks', 'spoon', 'wasabi', 'soy_sauce', 'tea', 'menu', 'special_order', 'takeout_box',
  'pudding', 'green_tea_ice_cream', 'fruit',
];
function cardHue(type) {
  const i = CARD_ORDER.indexOf(type);
  if (i >= 0) return Math.round((i * 360) / CARD_ORDER.length);
  let h = 0; // hash fallback for any unknown type
  for (let k = 0; k < type.length; k++) h = (h * 31 + type.charCodeAt(k)) >>> 0;
  return h % 360;
}
function cardStyle(c) {
  const h = cardHue(c.type);
  return `background:hsl(${h}deg 68% 90%);border-color:hsl(${h}deg 50% 48%)`;
}

export default {
  mount(rootEl, sdk) {
    const me = sdk.me;
    const roster = new Set([me.symbol].filter(s => s && s !== 'spectator'));
    let pub = null;           // public state (played, counts, scores) — seen by everyone
    let myHand = [];           // this player's own hand — delivered privately
    let menuOffer = null;      // 4 cards revealed by a Menu — delivered privately
    let chopFirstPick = null;  // index of first card picked when using Chopsticks
    let chopsticksActive = false; // player clicked their tableau Chopsticks to use it

    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="sg-layout">
        <div class="sg-main">
          <div class="sg-status" id="sg-status"></div>
          <div id="sg-config"></div>
          <div id="sg-hand"></div>
          <div class="sg-tableau" id="sg-tableau"></div>
          <div id="sg-results"></div>
        </div>
        <aside class="sg-aside">
          <h3>Players</h3>
          <div id="sg-players"></div>
          <h3 style="margin-top:.8rem">Scores</h3>
          <div id="sg-scores"></div>
          <h3 style="margin-top:.8rem">Chat</h3>
          <div id="sg-chat" style="height:200px"></div>
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
      if (pub) { cfg.innerHTML = ''; return; }
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
    const menuTypes = () => {
      const m = pub?.menu;
      return m ? ['nigiri', m.roll, ...(m.appetizers ?? []), ...(m.specials ?? []), m.dessert] : [];
    };

    function renderHand() {
      const el = $('#sg-hand');
      if (!pub || pub.phase !== 'playing') { el.innerHTML = ''; return; }
      const mine = Boolean(pub.selected?.[me.symbol]);
      const waiting = pub.pendingCount ?? 0;

      // Menu: 4 cards offered — choose one to play
      if (menuOffer && menuOffer.length) {
        el.innerHTML = `
          <div class="sg-status">Menu — choose one card to play:</div>
          <div class="sg-hand">
            ${menuOffer.map((c, i) =>
              `<button class="sg-card play" data-mi="${i}" ${c.type === 'menu' ? 'disabled' : ''}>${cardLabel(c)}</button>`
            ).join('')}
          </div>`;
        el.querySelectorAll('.sg-card[data-mi]').forEach(b =>
          b.addEventListener('click', () =>
            sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ menuChoice: +b.dataset.mi }) })));
        return;
      }

      const hasSpoon = (pub.played?.[me.symbol] ?? []).some(c => c.type === 'spoon');

      const spoonCtl = (!mine && hasSpoon) ? `
        <div class="sg-spoon">
          <label><input type="checkbox" id="sg-spoon-on"> Use Spoon — take a
            <select id="sg-spoon-type">${menuTypes().map(t => `<option value="${t}">${prettify(t)}</option>`).join('')}</select>
            from a neighbour when you keep your card</label>
        </div>` : '';

      const chopBanner = (!mine && chopsticksActive) ? `
        <div class="sg-chopsticks">Chopsticks active — pick <b>two</b> cards to play both
          (click your Chopsticks again to cancel)</div>` : '';

      el.innerHTML = `
        <div class="sg-status">Round ${pub.round}/3 —
          ${mine ? `<span class="sg-waiting">selected, waiting for others (${waiting}/${pub.symbols.length})</span>`
                 : 'pick a card to keep'}</div>
        ${spoonCtl}${chopBanner}
        <div class="sg-hand">
          ${myHand.map((c, i) =>
            `<button class="sg-card ${mine ? '' : 'play'}${chopFirstPick === i ? ' selected' : ''}" data-i="${i}" style="${chopFirstPick === i ? '' : cardStyle(c)}" ${mine ? 'disabled' : ''}>${cardLabel(c)}</button>`
          ).join('')}
        </div>`;

      if (!mine) {
        el.querySelectorAll('.sg-card[data-i]').forEach(b =>
          b.addEventListener('click', () => {
            const i = +b.dataset.i;
            if (chopsticksActive) {
              // Two-step selection: choose two hand cards to play with Chopsticks
              if (chopFirstPick === null) {
                chopFirstPick = i;
                renderHand();
                return;
              }
              if (chopFirstPick === i) {
                chopFirstPick = null;  // clicking the same card again deselects
                renderHand();
                return;
              }
              sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ pick: chopFirstPick, pick2: i }) });
              chopFirstPick = null;
              chopsticksActive = false;
            } else {
              const move = { pick: i };
              if (myHand[i]?.type === 'menu') move.bonus = 'menu';
              else if ($('#sg-spoon-on')?.checked) { move.bonus = 'spoon'; move.cardType = $('#sg-spoon-type').value; }
              sdk.send('move', { room: sdk.room.id, data: JSON.stringify(move) });
            }
          }));
      }
    }

    function renderTableau() {
      const el = $('#sg-tableau');
      if (!pub) { el.innerHTML = ''; return; }
      const history = pub.history ?? {};
      const mine = Boolean(pub.selected?.[me.symbol]);
      const canUseChop = pub.phase === 'playing' && !mine && myHand.length >= 2;
      el.innerHTML = pub.symbols.map(s => {
        const played = pub.played?.[s] ?? [];
        const desserts = pub.desserts?.[s] ?? [];
        const total = pub.totals?.[s] ?? 0;
        const isMe = s === me.symbol;
        // Sort a display copy by type (then by label) so identical cards cluster
        // and it's easy to see how many of each you've collected.
        const sorted = [...played, ...desserts]
          .sort((a, b) => a.type.localeCompare(b.type) || cardText(a).localeCompare(cardText(b)));
        const chips = sorted.map(c => {
          const label = cardLabel(c).replace(/<[^>]+>/g, ' ').trim();
          if (isMe && canUseChop && c.type === 'chopsticks') {
            return `<button class="sg-chop-chip${chopsticksActive ? ' active' : ''}" data-chop="1">${label} — ${chopsticksActive ? 'active (pick 2)' : 'click to use'}</button>`;
          }
          return `<span class="sg-chip" style="${cardStyle(c)}">${label}</span>`;
        }).join('');
        const historyHtml = (history[s] ?? []).map((cards, ri) => {
          if (!cards || cards.length === 0) return '';
          const pts = pub.roundScores?.[s]?.[ri] ?? 0;
          const cardChips = cards.map(c => `<span class="sg-history-chip" style="${cardStyle(c)}">${cardText(c)}</span>`).join('');
          return `<details class="sg-history-details">
            <summary>Round ${ri + 1}: ${pts} pts — click to see cards</summary>
            <div class="sg-history-chips">${cardChips}</div>
          </details>`;
        }).join('');
        return `<div class="sg-row">
            <h4><span>${s}${isMe ? ' (you)' : ''}</span><span>${total} pts</span></h4>
            ${historyHtml}
            <div class="sg-played">${chips || (pub.phase === 'playing' ? '<em>—</em>' : '')}</div>
          </div>`;
      }).join('');

      // Clicking your own Chopsticks toggles Chopsticks mode for this turn.
      el.querySelector('.sg-chop-chip[data-chop]')?.addEventListener('click', () => {
        chopsticksActive = !chopsticksActive;
        chopFirstPick = null;
        renderHand();
        renderTableau();
      });
    }

    function renderScores() {
      const el = $('#sg-scores');
      if (!el) return;
      if (!pub || !pub.roundScores) { el.innerHTML = ''; return; }
      const isOver = pub.phase === 'gameOver';
      const headers = ['', 'R1', 'R2', 'R3', ...(isOver ? ['🍰'] : []), 'Σ'];
      el.innerHTML = `
        <table class="sg-score-table">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>
            ${pub.symbols.map(s => {
              const rs = pub.roundScores?.[s] ?? [];
              const dpts = pub.dessertScores?.[s] ?? 0;
              const cells = [s + (s === me.symbol ? ' ✓' : '')]
                .concat([0,1,2].map(i => rs[i] != null ? rs[i] : '—'))
                .concat(isOver ? [dpts] : [])
                .concat([pub.totals?.[s] ?? 0]);
              return `<tr class="${s === me.symbol ? 'me' : ''}">
                ${cells.map((c, i) =>
                  `<td${i === cells.length - 1 ? ' class="total"' : ''}>${c}</td>`).join('')}
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    }

    function renderResults() {
      const el = $('#sg-results');
      if (!el) return;
      if (pub?.phase !== 'gameOver') { el.innerHTML = ''; return; }
      const ranking = pub.ranking ?? [];
      if (ranking.length === 0) return;
      const top = ranking[0];
      el.innerHTML = `
        <div class="sg-results">
          <h3 style="margin:0 0 .5rem">${top.symbol === (ranking[1]?.symbol ?? '') ? 'Draw!' : top.symbol + ' wins!'} — Final Scores</h3>
          <table>
            <thead><tr><th>Player</th><th>Rd 1</th><th>Rd 2</th><th>Rd 3</th><th>🍰</th><th>Total</th></tr></thead>
            <tbody>
              ${ranking.map(({ symbol: s, score, desserts: dessertCount }) => {
                const rs = pub.roundScores?.[s] ?? [];
                const dpts = pub.dessertScores?.[s] ?? 0;
                const isWinner = score === top.score && dessertCount === top.desserts;
                return `<tr class="${isWinner ? 'winner' : ''}">
                  <td>${s}${s === me.symbol ? ' (you)' : ''}</td>
                  ${[0,1,2].map(i => `<td>${rs[i] ?? '—'}</td>`).join('')}
                  <td>${dpts}</td>
                  <td>${score}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    function redraw() { renderConfig(); renderHand(); renderTableau(); renderScores(); renderResults(); }

    // ---- events ---------------------------------------------------------
    function onJoined(e) {
      if (e.symbol && e.symbol !== 'spectator') roster.add(e.symbol);
      renderConfig();
    }
    function onPlayerLeft(e) { roster.delete(e.symbol); renderConfig(); }
    function onStarted(e)  { pub = JSON.parse(e.state); chopFirstPick = null; chopsticksActive = false; setStatus('Game started!'); redraw(); }
    function onMoved(e)    { pub = JSON.parse(e.data); chopFirstPick = null; chopsticksActive = false; redraw(); }
    function onPrivate(e)  { const p = JSON.parse(e.data); pub = p; myHand = p.myHand ?? []; menuOffer = p.menuOffer ?? null; chopFirstPick = null; chopsticksActive = false; redraw(); }
    function onFinished(e) {
      pub = JSON.parse(e.state);
      const r = pub.ranking ?? [];
      const msg = e.winner === 'draw' ? 'Draw!' : `${e.winner} wins!`;
      setStatus(`Game over — ${msg}`);
      redraw();
    }
    function onLobbyReset() { pub = null; myHand = []; menuOffer = null; chopFirstPick = null; chopsticksActive = false; setStatus('Back in lobby'); redraw(); }
    function onRematched(e) { pub = JSON.parse(e.state); chopFirstPick = null; chopsticksActive = false; setStatus('Rematch!'); redraw(); }
    function onError(e)    { sdk.toast(e.message); }

    sdk.on('joined',       onJoined);
    sdk.on('playerLeft',   onPlayerLeft);
    sdk.on('started',      onStarted);
    sdk.on('moved',        onMoved);
    sdk.on('privateState', onPrivate);
    sdk.on('finished',     onFinished);
    sdk.on('lobbyReset',   onLobbyReset);
    sdk.on('rematched',    onRematched);
    sdk.on('gameError',    onError);

    setStatus(`You are ${me.symbol}${me.isHost ? ' (host)' : ''}`);
    redraw();

    // ---- cleanup --------------------------------------------------------
    return () => {
      cleanupPlayers?.();
      cleanupChat?.();
      sdk.off('joined',       onJoined);
      sdk.off('playerLeft',   onPlayerLeft);
      sdk.off('started',      onStarted);
      sdk.off('moved',        onMoved);
      sdk.off('privateState', onPrivate);
      sdk.off('finished',     onFinished);
      sdk.off('lobbyReset',   onLobbyReset);
      sdk.off('rematched',    onRematched);
      sdk.off('gameError',    onError);
    };
  }
};
