/**
 * Kaiten — Game UI.
 *
 * renderSettings(el, sdk) — shown to everyone in the platform's waiting room
 *   before the match starts; only the host gets a real picker (menu preset,
 *   then configure()+start()) — Kaiten has nothing else pre-start for anyone
 *   else. Reads sdk.players (the platform's live roster) at click time —
 *   never tracks its own copy.
 * mount(rootEl, sdk) — called only once the match is actually starting/
 *   active; renders hand/tableau/scores/results only. Players + chat live in
 *   the platform's persistent room chrome.
 */

import { initials } from '/shell/util.js';

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
  .sg-status{font-weight:600;margin-bottom:.5rem}
  .sg-hand{display:flex;flex-wrap:wrap;gap:.4rem;margin:.5rem 0}
  .sg-card{border:1px solid #999;border-radius:8px;padding:.4rem .5rem;min-width:76px;max-width:96px;
           background:#fff;color:#222;cursor:default;font-size:.8rem;text-align:center;line-height:1.3}
  .sg-card.play{cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.15)}
  .sg-card.play:hover{box-shadow:0 2px 8px rgba(0,0,0,.3);filter:brightness(1.04)}
  .sg-card small{display:block;color:#555}
  .sg-card-emoji{font-size:1.6rem;display:block;margin-bottom:.15rem;line-height:1}
  .sg-card-name{font-weight:600;font-size:.78rem}
  .sg-card-pts{display:block;color:#666;font-size:.65rem;margin-top:.15rem;line-height:1.2}
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
  .sg-score-table{width:100%;border-collapse:collapse;font-size:.78rem;margin-top:.4rem;background:#fff}
  .sg-score-table th,.sg-score-table td{padding:.2rem .35rem;text-align:center;border:1px solid #ddd;color:#222}
  .sg-score-table th{background:#f5f5f5;font-weight:600}
  .sg-score-table tr.me td{background:#fffce0}
  .sg-score-table td.total{font-weight:700}
  .sg-history-details{font-size:.75rem;color:#555;margin:.15rem 0}
  .sg-history-details summary{cursor:pointer;color:#448;user-select:none}
  .sg-history-chips{display:flex;flex-wrap:wrap;gap:.2rem;margin-top:.2rem}
  .sg-history-chip{background:#e8e8e8;color:#333;border:1px solid #ccc;border-radius:4px;padding:.1rem .3rem}
  .sg-results{margin-top:1rem;border:2px solid #2a7;border-radius:8px;padding:.8rem;background:#fff}
  .sg-results table{width:100%;border-collapse:collapse;font-size:.88rem}
  .sg-results th,.sg-results td{padding:.3rem .5rem;text-align:right;border-bottom:1px solid #eee;color:#222}
  .sg-results th:first-child,.sg-results td:first-child{text-align:left}
  .sg-results tr.winner td{font-weight:700;color:#1a7}
`;

// Emoji per card type
const CARD_EMOJI = {
  nigiri:              '🍣',
  maki:                '🍱',
  temaki:              '🌯',
  uramaki:             '🍥',
  tempura:             '🍤',
  sashimi:             '🐟',
  dumpling:            '🥟',
  eel:                 '🐍',
  tofu:                '🧊',
  onigiri:             '🍙',
  edamame:             '🫛',
  miso:                '🍲',
  chopsticks:          '🥢',
  spoon:               '🥄',
  wasabi:              '🌿',
  soy_sauce:           '🍶',
  tea:                 '🍵',
  menu:                '📜',
  special_order:       '📋',
  takeout_box:         '🥡',
  pudding:             '🍮',
  green_tea_ice_cream: '🍨',
  fruit:               '🍉',
};

// Short scoring rule per card type — shown on full cards
function cardPoints(type) {
  switch (type) {
    case 'nigiri':              return 'Egg 1 · Salmon 2 · Squid 3 (×3 on Wasabi)';
    case 'maki':                return 'Most icons: 6pts (2nd: 3)';
    case 'temaki':              return 'Most: +4 · Fewest: −4';
    case 'uramaki':             return 'Top 3 in game: 8 / 5 / 2';
    case 'tempura':             return 'Set of 2 = 5';
    case 'sashimi':             return 'Set of 3 = 10';
    case 'dumpling':            return '1/3/6/10/15 (1–5 cards)';
    case 'eel':                 return '1 card = −3 · 2+ = 7';
    case 'tofu':                return '1 = 2 · 2 = 6 · 3+ = 0';
    case 'onigiri':             return 'Unique shape sets: 1/4/9/16';
    case 'edamame':             return '1pt per opponent with Edamame';
    case 'miso':                return '3pts each (if not doubled)';
    case 'wasabi':              return 'Next Nigiri ×3';
    case 'chopsticks':          return 'Later: swap for 2 picks';
    case 'spoon':               return 'Later: take a card from neighbour';
    case 'soy_sauce':           return '4pts if you have most colours';
    case 'tea':                 return '1pt × largest colour group';
    case 'menu':                return 'Pick 1 of 4 from draw pile';
    case 'special_order':       return 'Copy any card you played';
    case 'takeout_box':         return 'Flip cards for 2pts each';
    case 'pudding':             return 'Game end: Most +6 · Fewest −6';
    case 'green_tea_ice_cream': return 'Game end: Set of 4 = 12';
    case 'fruit':               return 'Game end: icons per type −2/0/1/3/6/10';
    default:                    return '';
  }
}

// full card HTML: emoji + name/variant + points rule
function cardLabel(c) {
  const emoji = CARD_EMOJI[c.type] ?? '🍽️';
  const pts   = cardPoints(c.type);
  switch (c.type) {
    case 'nigiri':
      return `<span class="sg-card-emoji">${emoji}${c.onWasabi ? '🌿' : ''}</span><span class="sg-card-name">Nigiri<small>${c.variant}${c.onWasabi ? ' ×3' : ''}</small></span><span class="sg-card-pts">${pts}</span>`;
    case 'maki':
      return `<span class="sg-card-emoji">${emoji}</span><span class="sg-card-name">Maki<small>${c.icons} icon${c.icons > 1 ? 's' : ''}</small></span><span class="sg-card-pts">${pts}</span>`;
    case 'uramaki':
      return `<span class="sg-card-emoji">${emoji}</span><span class="sg-card-name">Uramaki<small>${c.icons} icons</small></span><span class="sg-card-pts">${pts}</span>`;
    case 'onigiri':
      return `<span class="sg-card-emoji">${emoji}</span><span class="sg-card-name">Onigiri<small>${c.shape}</small></span><span class="sg-card-pts">${pts}</span>`;
    case 'fruit':
      return `<span class="sg-card-emoji">${emoji}</span><span class="sg-card-name">Fruit<small>${c.fruits.join('/')}</small></span><span class="sg-card-pts">${pts}</span>`;
    default:
      return `<span class="sg-card-emoji">${emoji}</span><span class="sg-card-name">${prettify(c.type)}</span><span class="sg-card-pts">${pts}</span>`;
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
  // ---- pre-start settings (shown to everyone in the platform waiting room;
  // only the host gets an actual picker — Kaiten has nothing else to offer
  // non-hosts pre-start) --------------------------------------------------
  renderSettings(el, sdk) {
    if (!sdk.me.isHost) {
      el.innerHTML = `<p class="sh-small">Waiting for the host to start…</p>`;
      return () => {};
    }

    el.innerHTML = `
      <style>${STYLE}</style>
      <div class="sg-menu">
        <label>Menu:
          <select id="sg-preset">
            ${MENU_PRESETS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
        </label>
        <button id="sg-start">Start game</button>
      </div>`;

    el.querySelector('#sg-start').addEventListener('click', () => {
      const preset = el.querySelector('#sg-preset').value;
      const players = sdk.players.filter(p => !p.spectator).map(p => p.user);
      if (players.length < 2) { sdk.toast('Need at least 2 players'); return; }
      sdk.send('configure', { room: sdk.room.id, settings: JSON.stringify({ preset, players }) });
      sdk.send('start', { room: sdk.room.id });
    });

    return () => {};
  },

  // ---- gameplay (mounted only once the match is starting/active) ----------
  mount(rootEl, sdk) {
    const me = sdk.me;
    let pub = null;           // public state (played, counts, scores) — seen by everyone
    let myHand = [];           // this player's own hand — delivered privately
    let menuOffer = null;      // 4 cards revealed by a Menu — delivered privately
    let chopFirstPick = null;  // index of first card picked when using Chopsticks
    let chopsticksActive = false; // player clicked their tableau Chopsticks to use it

    rootEl.innerHTML = `
      <style>${STYLE}</style>
      <div class="sg-status" id="sg-status"></div>
      <div id="sg-hand"></div>
      <div class="sg-tableau" id="sg-tableau"></div>
      <div id="sg-scores"></div>
      <div id="sg-results"></div>
    `;

    const $ = id => rootEl.querySelector(id);
    const statusEl = $('#sg-status');
    const setStatus = m => { statusEl.textContent = m; };

    // ---- gameplay rendering --------------------------------------------
    const menuTypes = () => {
      const m = pub?.menu;
      return m ? ['nigiri', m.roll, ...(m.appetizers ?? []), ...(m.specials ?? []), m.dessert] : [];
    };

    function renderHand() {
      const el = $('#sg-hand');
      if (!pub || pub.phase !== 'playing') { el.innerHTML = ''; return; }
      const mine = Boolean(pub.selected?.[me.user]);
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

      const hasSpoon = (pub.played?.[me.user] ?? []).some(c => c.type === 'spoon');

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
      const mine = Boolean(pub.selected?.[me.user]);
      const canUseChop = pub.phase === 'playing' && !mine && myHand.length >= 2;
      el.innerHTML = pub.symbols.map(s => {
        const played = pub.played?.[s] ?? [];
        const desserts = pub.desserts?.[s] ?? [];
        const total = pub.totals?.[s] ?? 0;
        const isMe = s === me.user;
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
            <h4><span>${initials(s)}${isMe ? ' (you)' : ''}</span><span>${total} pts</span></h4>
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
              const cells = [initials(s) + (s === me.user ? ' ✓' : '')]
                .concat([0,1,2].map(i => rs[i] != null ? rs[i] : '—'))
                .concat(isOver ? [dpts] : [])
                .concat([pub.totals?.[s] ?? 0]);
              return `<tr class="${s === me.user ? 'me' : ''}">
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
          <h3 style="margin:0 0 .5rem">${top.symbol === (ranking[1]?.symbol ?? '') ? 'Draw!' : initials(top.symbol) + ' wins!'} — Final Scores</h3>
          <table>
            <thead><tr><th>Player</th><th>Rd 1</th><th>Rd 2</th><th>Rd 3</th><th>🍰</th><th>Total</th></tr></thead>
            <tbody>
              ${ranking.map(({ symbol: s, score, desserts: dessertCount }) => {
                const rs = pub.roundScores?.[s] ?? [];
                const dpts = pub.dessertScores?.[s] ?? 0;
                const isWinner = score === top.score && dessertCount === top.desserts;
                return `<tr class="${isWinner ? 'winner' : ''}">
                  <td>${initials(s)}${s === me.user ? ' (you)' : ''}</td>
                  ${[0,1,2].map(i => `<td>${rs[i] ?? '—'}</td>`).join('')}
                  <td>${dpts}</td>
                  <td>${score}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`;
    }

    function redraw() { renderHand(); renderTableau(); renderScores(); renderResults(); }

    // ---- events ---------------------------------------------------------
    function onStarted(e)  { pub = JSON.parse(e.state); chopFirstPick = null; chopsticksActive = false; setStatus('Game started!'); redraw(); }
    function onMoved(e)    { pub = JSON.parse(e.data); chopFirstPick = null; chopsticksActive = false; redraw(); }
    function onPrivate(e)  { const p = JSON.parse(e.data); pub = p; myHand = p.myHand ?? []; menuOffer = p.menuOffer ?? null; chopFirstPick = null; chopsticksActive = false; redraw(); }
    function onFinished(e) {
      pub = JSON.parse(e.state);
      const msg = e.winner === 'draw' ? 'Draw!' : `${initials(e.winner)} wins!`;
      setStatus(`Game over — ${msg}`);
      redraw();
    }
    function onRematched(e) { pub = JSON.parse(e.state); chopFirstPick = null; chopsticksActive = false; setStatus('Rematch!'); redraw(); }
    function onError(e)    { sdk.toast(e.message); }

    sdk.on('started',      onStarted);
    sdk.on('moved',        onMoved);
    sdk.on('privateState', onPrivate);
    sdk.on('finished',     onFinished);
    sdk.on('rematched',    onRematched);
    sdk.on('gameError',    onError);

    setStatus('Loading…');

    // ---- cleanup --------------------------------------------------------
    return () => {
      sdk.off('started',      onStarted);
      sdk.off('moved',        onMoved);
      sdk.off('privateState', onPrivate);
      sdk.off('finished',     onFinished);
      sdk.off('rematched',    onRematched);
      sdk.off('gameError',    onError);
    };
  }
};
