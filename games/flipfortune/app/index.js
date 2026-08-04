/**
 * Flip Fortune — Game UI ("High-Roller Card Room" pixel theme).
 *
 * Deliberately a different pixel identity from Kaperfahrt (deep maroon/brass
 * card-room felt vs. Kaperfahrt's teal pirate palette; a poker-chip-stack
 * scoreboard instead of segmented bars; round-only history instead of a
 * per-flip log). mount(rootEl, sdk) is called once the match is
 * starting/active.
 *
 * - The deck is a thick fanned card-stack sprite (./sprites.js `deckstack`) —
 *   visually distinct from an individual card front — and every flip animates
 *   a card flying from the deck to the flipping player's tableau slot (a FLIP
 *   transform, the same technique Kaperfahrt uses for dice).
 * - A duplicate flip that busts a player is NOT silently discarded on screen:
 *   the fresh duplicate renders in their row and both it and its earlier twin
 *   pulse red, so everyone sees exactly what busted them.
 * - The rail shows a "Round History" of completed rounds only (built from
 *   `state.roundSummary`, one row per round; click to expand what everyone
 *   held) — no live per-card log.
 * - The scoreboard renders a small stack of pixel poker chips per player,
 *   proportional to their score against the target, instead of a bar.
 *
 * The shell's Players/Chat panels (#room-players/#room-chat) are left
 * untouched — they're platform-owned chrome for the room's whole lifetime,
 * and the tableau below already shows every player's avatar/name/score, so
 * there's no functional gap in skipping them.
 */

import { SPRITE } from './sprites.js';

const MOD_COLOR = { '+2': '#2f8f5e', '+4': '#2f8f5e', '+6': '#2f8f5e', '+8': '#2f8f5e', '+10': '#2f8f5e', x2: '#a8283a' };
const ACTION_META = {
  freeze: { icon: 'freeze', label: 'Freeze', color: '#6fd7f2' },
  flipthree: { icon: 'flipthree', label: 'Flip Three', color: '#d4a03c' },
  secondchance: { icon: 'secondchance', label: '2nd Chance', color: '#2f8f5e' },
};
const STATUS_META = {
  active: { label: 'In play', cls: 'act' },
  stayed: { label: 'Stayed', cls: 'stay' },
  busted: { label: 'Busted', cls: 'bust' },
  frozen: { label: 'Frozen', cls: 'frz' },
};
const CHIP_SLOTS = 8; // chips shown at (and beyond) the target score

function cardFace(c, extraCls = '') {
  if (!c) return '';
  if (c.kind === 'number') return `<div class="ff-card num ${extraCls}"><span class="ff-num">${c.value}</span></div>`;
  if (c.kind === 'modifier') {
    return `<div class="ff-card mod ${extraCls}" style="--accent:${MOD_COLOR[c.mod]}"><span class="ff-mod">${c.mod === 'x2' ? '×2' : c.mod}</span></div>`;
  }
  const m = ACTION_META[c.action] || { icon: '', label: c.action, color: '#d4a03c' };
  return `<div class="ff-card act ${extraCls}" style="--accent:${m.color}"><span class="ff-icon">${SPRITE[m.icon] || ''}</span></div>`;
}

function cardLabel(c) {
  if (c.kind === 'number') return `Number ${c.value}`;
  if (c.kind === 'modifier') return c.mod === 'x2' ? '×2 modifier' : `${c.mod} modifier`;
  return (ACTION_META[c.action] || {}).label || c.action;
}

const STYLE = `
  @font-face{font-family:'Pixelify Sans';src:url('./pixelify.ttf') format('truetype');font-weight:400 700;font-display:swap}

  .ff-root{
    --felt:#3a1220; --felt2:#2a0c16; --ink2:#4a1826; --panel:#4a1826; --panel2:#5c1f2e; --key:#8a3a4a;
    --line:#180810; --cream:#f4efe1; --muted:#caa78f;
    --brass:#d4a03c; --brass-d:#8a6420; --crimson:#c23b4e; --crimson-d:#7a1c28;
    --emerald:#3ecf8e; --emerald-d:#1c6b44; --cyan:#6fd7f2; --cyan-d:#2b8ba8;
    --pix:'Pixelify Sans', ui-monospace, "SFMono-Regular", "Courier New", monospace;
    display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;
    position:relative; padding:16px; border-radius:16px; color:var(--cream);
    font-family:var(--pix);
    background:
      radial-gradient(90% 70% at 50% 0%, rgba(212,160,60,.10), rgba(0,0,0,0) 60%),
      radial-gradient(120% 95% at 50% -10%, var(--felt) 0%, var(--felt2) 55%, #170609 100%);
    box-shadow:inset 0 0 0 3px var(--brass-d), inset 0 0 90px rgba(0,0,0,.6), 0 12px 30px rgba(0,0,0,.4);
  }
  .ff-root::before{content:"";position:absolute;inset:6px;border-radius:11px;pointer-events:none;z-index:0;
    box-shadow:inset 0 0 0 1px rgba(212,160,60,.25)}

  /* ---- stage ---- */
  .ff-stage{position:relative;z-index:1;flex:1 1 440px;min-width:300px;border-radius:12px;padding:14px 12px 12px;
    background:radial-gradient(85% 70% at 30% 15%, rgba(212,160,60,.08), rgba(0,0,0,0) 60%);}
  .ff-status{font-weight:700;font-size:1.1rem;letter-spacing:.02em;margin:2px 4px 12px;text-shadow:2px 2px 0 var(--line)}

  /* ---- deck + draw animation ---- */
  .ff-drawrow{display:flex;align-items:center;gap:16px;margin:0 4px 16px;min-height:76px}
  .ff-deckwrap{position:relative;flex:0 0 auto}
  .ff-deck{width:52px;height:52px;filter:drop-shadow(0 4px 0 rgba(0,0,0,.45))}
  .ff-deck svg{width:100%;height:100%}
  .ff-deckcount{font-size:.62rem;color:var(--muted);text-align:center;margin-top:4px;letter-spacing:.05em}
  .ff-drawinfo{font-size:.78rem;color:var(--muted);min-width:0}
  .ff-drawinfo b{color:var(--cream)}

  /* the flying card — absolutely positioned, animated from deck to tableau slot */
  .ff-flying{position:fixed;z-index:50;pointer-events:none;will-change:transform,opacity}

  /* ---- pixel card ---- */
  .ff-card{width:40px;height:56px;box-sizing:border-box;border:3px solid var(--line);border-radius:5px;
    background:#f4efe1;display:flex;align-items:center;justify-content:center;position:relative;
    box-shadow:inset 2px 2px 0 rgba(255,255,255,.55), inset -2px -2px 0 rgba(0,0,0,.15), 2px 3px 0 rgba(0,0,0,.4)}
  .ff-card.num{border-color:var(--brass-d)}
  .ff-card.num .ff-num{font-weight:700;font-size:1.25rem;color:var(--felt2)}
  .ff-card.mod{background:linear-gradient(180deg,#fff,var(--accent));border-color:var(--accent)}
  .ff-card.mod .ff-mod{font-weight:700;font-size:.82rem;color:var(--felt2)}
  .ff-card.act{background:var(--ink2);border-color:var(--accent);
    box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent), 2px 3px 0 rgba(0,0,0,.4)}
  .ff-card.act .ff-icon{width:24px;height:24px}
  .ff-card.dup{animation:ff-dup 1s ease-in-out 2;border-color:var(--crimson) !important;
    box-shadow:0 0 0 2px var(--crimson), 2px 3px 0 rgba(0,0,0,.4)}
  @keyframes ff-dup{0%,100%{filter:none}50%{filter:brightness(.7) saturate(1.6) hue-rotate(-8deg)}}
  .ff-card.new{animation:ff-deal .22s ease-out}
  @keyframes ff-deal{0%{transform:scale(.5);opacity:0}100%{transform:none;opacity:1}}

  /* ---- player tableaus (enhanced card-row grid) ---- */
  .ff-tableaus{display:flex;flex-wrap:wrap;gap:10px;margin:0 2px}
  .ff-tab{flex:1 1 230px;min-width:210px;position:relative;border-radius:11px;padding:.65rem .7rem;
    background:linear-gradient(180deg,var(--panel2),var(--panel));
    box-shadow:inset 0 0 0 2px var(--key), 0 4px 0 rgba(0,0,0,.35);
    border:2px solid var(--brass-d);transition:box-shadow .15s ease,border-color .15s ease}
  .ff-tab::before{content:"";position:absolute;inset:3px;border-radius:8px;pointer-events:none;
    box-shadow:inset 0 0 0 1px rgba(212,160,60,.18)}
  .ff-tab.act{border-color:var(--brass);box-shadow:inset 0 0 0 2px var(--key), 0 0 0 2px rgba(212,160,60,.55), 0 4px 0 rgba(0,0,0,.35)}
  .ff-tab.win{border-color:var(--emerald);box-shadow:inset 0 0 0 2px var(--key), 0 0 0 2px rgba(62,207,142,.6), 0 4px 0 rgba(0,0,0,.35)}
  .ff-tab.bust{filter:saturate(.85)}
  .ff-plate{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;position:relative;z-index:1}
  .ff-ava{flex:0 0 auto;width:26px;height:26px;border-radius:5px;background:var(--felt2) center/cover;
    border:2px solid var(--brass-d);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--cream);font-size:.72rem}
  .ff-tab-name{flex:1;min-width:0;font-weight:700;font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ff-badge{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:2px 6px;
    border-radius:5px;border:2px solid var(--line);background:var(--ink2);color:var(--muted)}
  .ff-badge.act{background:var(--cyan);color:#052733}
  .ff-badge.stay{background:var(--emerald);color:#06231a}
  .ff-badge.bust{background:var(--crimson);color:#fff}
  .ff-badge.frz{background:var(--cyan);color:#052733}
  .ff-tab-cards{display:flex;flex-wrap:wrap;gap:4px;min-height:56px;position:relative;z-index:1}
  .ff-tab-foot{display:flex;justify-content:space-between;align-items:center;margin-top:.5rem;font-size:.68rem;color:var(--muted);position:relative;z-index:1}
  .ff-uniq{font-weight:700;color:var(--brass)}
  .ff-uniq.f7{color:var(--emerald)}
  .ff-score{font-weight:700;font-size:.92rem;color:var(--brass);text-shadow:1px 1px 0 var(--line)}

  /* ---- controls / target picker ---- */
  .ff-controls{display:flex;flex-wrap:wrap;gap:.6rem;margin:.9rem 4px .2rem}
  .ff-btn{font-family:var(--pix);font-weight:700;font-size:.95rem;letter-spacing:.02em;
    color:var(--felt2);border:3px solid var(--line);border-radius:8px;padding:.5rem 1.05rem;
    cursor:pointer;background:linear-gradient(180deg,#f0d488,var(--brass));
    box-shadow:inset 0 2px 0 rgba(255,255,255,.5), 0 4px 0 var(--brass-d);
    transition:transform .08s ease, box-shadow .08s ease}
  .ff-btn:hover:not(:disabled){filter:brightness(1.05)}
  .ff-btn:active:not(:disabled){transform:translateY(4px);box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 0 0 var(--brass-d)}
  .ff-btn:disabled{opacity:.4;cursor:not-allowed}
  .ff-btn.big{font-size:1.05rem;padding:.55rem 1.15rem}
  .ff-btn.stop{color:#fff;background:linear-gradient(180deg,#e0616f,var(--crimson));box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 4px 0 var(--crimson-d)}
  .ff-btn.stop:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--crimson-d)}
  .ff-picker{border:3px solid var(--brass);border-radius:11px;padding:.65rem .7rem;margin:.8rem 4px .2rem;
    background:rgba(212,160,60,.1)}
  .ff-picker-title{font-size:.78rem;font-weight:700;color:var(--brass);margin-bottom:.5rem;display:flex;align-items:center;gap:6px}
  .ff-picker-title .ff-picon{width:18px;height:18px}
  .ff-picker-opts{display:flex;flex-wrap:wrap;gap:.5rem}
  .ff-wait{font-size:.82rem;color:var(--muted);margin:.9rem 4px .2rem}

  /* ---- rail: chip scoreboard + round history ---- */
  .ff-rail{position:relative;z-index:1;flex:0 0 258px;min-width:230px;display:flex;flex-direction:column;gap:12px}
  .ff-side{border:2px solid var(--brass-d);border-radius:12px;padding:.7rem;
    background:linear-gradient(180deg,var(--panel),#3a1420);box-shadow:inset 0 0 0 2px var(--key)}
  .ff-side h3,.ff-history h3{margin:.1rem 0 .6rem;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:center}

  .ff-chiprow{display:flex;align-items:center;gap:.6rem;padding:.45rem .5rem;border-radius:9px;margin-bottom:.5rem;
    background:var(--ink2);border:2px solid var(--line)}
  .ff-chiprow:last-child{margin-bottom:0}
  .ff-chiprow.act{border-color:var(--cyan);box-shadow:0 0 0 2px rgba(111,215,242,.4)}
  .ff-chiprow.win{border-color:var(--emerald);box-shadow:0 0 0 2px rgba(62,207,142,.5)}
  .ff-chip-ava{flex:0 0 auto;width:24px;height:24px;border-radius:5px;background:var(--felt2) center/cover;
    border:2px solid var(--brass-d);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--cream);font-size:.66rem}
  .ff-chip-mid{flex:1;min-width:0}
  .ff-chip-name{font-size:.75rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ff-chip-stack{position:relative;height:20px;display:flex;align-items:flex-end;margin-top:3px}
  .ff-chip-ic{width:16px;height:16px;margin-left:-9px;image-rendering:pixelated}
  .ff-chip-ic:first-child{margin-left:0}
  .ff-chip-ic.over{filter:drop-shadow(0 0 3px rgba(212,160,60,.9))}
  .ff-chip-score{flex:0 0 auto;font-weight:700;font-size:.92rem;color:var(--brass);text-shadow:1px 1px 0 var(--line)}
  .ff-target{font-size:.66rem;color:var(--muted);text-align:center;margin-top:.5rem}
  .ff-target b{color:var(--brass)}

  .ff-history{border:2px solid var(--brass-d);border-radius:12px;padding:.6rem .5rem;
    background:var(--ink2);box-shadow:inset 0 0 0 2px var(--key);max-height:260px;overflow-y:auto}
  .ff-history .ff-empty{font-size:.72rem;color:var(--muted);text-align:center;padding:.4rem 0}
  .ff-hrow{border-bottom:1px solid rgba(212,160,60,.12);padding:6px 3px;cursor:pointer}
  .ff-hrow:last-child{border-bottom:none}
  .ff-hrow.fresh{animation:ff-hflash 1s ease}
  @keyframes ff-hflash{0%{background:rgba(212,160,60,.4)}100%{background:transparent}}
  .ff-hsum{display:flex;align-items:center;gap:6px;font-size:.72rem}
  .ff-hsum .rn{flex:0 0 auto;font-weight:700;color:var(--brass);width:32px}
  .ff-hsum .pl{flex:1;min-width:0;display:flex;flex-wrap:wrap;gap:5px;color:var(--muted)}
  .ff-hsum .pl b.bust{color:var(--crimson)}
  .ff-hsum .pl b.f7{color:var(--emerald)}
  .ff-hsum .pl b.pos{color:var(--cream)}
  .ff-hdetail{display:none;margin-top:6px;flex-direction:column;gap:5px}
  .ff-hrow.open .ff-hdetail{display:flex}
  .ff-hdetail-row{display:flex;align-items:center;gap:6px;font-size:.7rem}
  .ff-hdetail-name{flex:0 0 68px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
  .ff-hdetail-cards{display:flex;flex-wrap:wrap;gap:2px;flex:1;min-width:0}
  .ff-hdetail-cards .ff-card{width:22px;height:30px;font-size:.6rem}
  .ff-hdetail-cards .ff-icon{width:12px;height:12px}
  .ff-hdetail-pts{flex:0 0 auto;font-weight:700;min-width:42px;text-align:right}
  .ff-hdetail-pts.bust{color:var(--crimson)}
  .ff-hdetail-pts.f7{color:var(--emerald)}

  /* ---- round-summary / win overlay ---- */
  .ff-summary{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
    background:rgba(15,3,7,.85);border-radius:16px;cursor:pointer;animation:ff-fadein .2s ease;overflow:auto;padding:10px}
  .ff-summary[hidden]{display:none}
  @keyframes ff-fadein{from{opacity:0}to{opacity:1}}
  .ff-sum-panel{min-width:280px;max-width:92%;border:3px solid var(--brass);border-radius:14px;padding:16px 20px;
    background:linear-gradient(180deg,var(--panel2),var(--panel));
    box-shadow:inset 0 0 0 2px var(--key),0 16px 44px rgba(0,0,0,.6);animation:ff-slam .4s cubic-bezier(.2,1.3,.5,1)}
  @keyframes ff-slam{0%{transform:translateY(-30px) rotate(-3deg);opacity:0}60%{transform:translateY(3px) rotate(1deg);opacity:1}100%{transform:none}}
  .ff-sum-title{text-align:center;font-weight:700;font-size:1.1rem;color:var(--brass);margin-bottom:12px;text-shadow:1px 1px 0 var(--line)}
  .ff-sum-rows{display:flex;flex-direction:column;gap:8px}
  .ff-sum-row{display:flex;align-items:center;gap:8px;border:2px solid var(--brass-d);border-radius:8px;padding:6px 8px;
    background:rgba(0,0,0,.15);animation:ff-linein .3s ease backwards}
  @keyframes ff-linein{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
  .ff-sum-name{flex:0 0 90px;font-weight:700;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ff-sum-cards{display:flex;flex-wrap:wrap;gap:3px;flex:1;min-width:0}
  .ff-sum-cards .ff-card{width:26px;height:36px;font-size:.72rem}
  .ff-sum-cards .ff-icon{width:16px;height:16px}
  .ff-sum-pts{flex:0 0 auto;font-weight:700;min-width:52px;text-align:right}
  .ff-sum-pts.bust{color:var(--crimson)}
  .ff-sum-pts.f7{color:var(--emerald)}
  .ff-sum-hint{text-align:center;font-size:.64rem;color:var(--muted);margin-top:12px;letter-spacing:.08em}
  .ff-win-panel{text-align:center}
  .ff-win-title{font-size:1.6rem;font-weight:700;color:var(--brass);text-shadow:2px 2px 0 var(--line);margin-bottom:8px}
  .ff-win-icon{width:64px;height:64px;margin:0 auto 8px}

  @media (prefers-reduced-motion: reduce){
    .ff-flying,.ff-card.new,.ff-card.dup,.ff-summary,.ff-sum-panel,.ff-sum-row,.ff-hrow.fresh{animation:none}
  }
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let st = null;
    let history = [];          // one entry per completed round (from roundSummary)
    let openHistoryIdx = new Set();
    let lastDealKey = null;    // dedupe the fly-in animation trigger
    let summaryTimer = null;
    let prevRoundSummaryKey = null;

    rootEl.innerHTML = `<div class="ff-root"><style>${STYLE}</style>
      <div class="ff-stage" id="ff-stage">
        <div class="ff-status" id="ff-status">Loading…</div>
        <div class="ff-drawrow">
          <div class="ff-deckwrap">
            <div class="ff-deck" id="ff-deck">${SPRITE.deckstack}</div>
            <div class="ff-deckcount" id="ff-deckcount"></div>
          </div>
          <div class="ff-drawinfo" id="ff-drawinfo"></div>
        </div>
        <div class="ff-tableaus" id="ff-tableaus"></div>
        <div class="ff-picker" id="ff-picker" hidden></div>
        <div class="ff-controls" id="ff-controls"></div>
        <div class="ff-wait" id="ff-wait"></div>
      </div>
      <aside class="ff-rail">
        <div class="ff-side"><h3>Chip Count</h3><div id="ff-chips"></div></div>
        <div class="ff-history"><h3>Round History</h3><div id="ff-hrows"></div></div>
      </aside>
      <div class="ff-summary" id="ff-summary" hidden></div>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && st.phase !== 'done' && st.turn === me;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });

    // ---- draw-from-deck fly animation (FLIP: from the deck's rect to the
    // just-dealt card's final tableau slot) ----
    function flyFromDeck(targetEl) {
      if (reduce || !targetEl) return;
      const deck = $('#ff-deck');
      if (!deck) return;
      const from = deck.getBoundingClientRect();
      const to = targetEl.getBoundingClientRect();
      if (!to.width) return;
      const ghost = targetEl.cloneNode(true);
      ghost.classList.add('ff-flying');
      ghost.style.left = `${from.left + from.width / 2 - to.width / 2}px`;
      ghost.style.top = `${from.top + from.height / 2 - to.height / 2}px`;
      ghost.style.width = `${to.width}px`;
      ghost.style.height = `${to.height}px`;
      ghost.style.transform = 'scale(.6) rotate(-12deg)';
      ghost.style.opacity = '0.3';
      document.body.appendChild(ghost);
      targetEl.style.visibility = 'hidden';
      window.requestAnimationFrame(() => {
        ghost.style.transition = 'left .38s cubic-bezier(.2,.8,.3,1), top .38s cubic-bezier(.2,.8,.3,1), transform .38s cubic-bezier(.2,.8,.3,1), opacity .3s ease';
        ghost.style.left = `${to.left}px`;
        ghost.style.top = `${to.top}px`;
        ghost.style.transform = 'none';
        ghost.style.opacity = '1';
      });
      setTimeout(() => { ghost.remove(); targetEl.style.visibility = ''; }, 420);
    }

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#ff-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'Game over — a draw!' : `${name(st.winner)} wins!`)
        : (st.pending
            ? (st.pending.by === me ? 'Resolve your action card…' : `Waiting for ${name(st.pending.by)} to resolve a card…`)
            : (myTurn() ? 'Your turn — flip or stay.' : `Waiting for ${name(st.turn)}…`));

      $('#ff-deckcount').textContent = `${st.drawCount ?? 0} cards left`;
      $('#ff-drawinfo').innerHTML = st.lastCard
        ? `<b>${name(st.lastCard.user)}</b> flipped ${cardLabel(st.lastCard.card)}`
        : 'Waiting for the first flip…';

      renderTableaus(name);
      renderPickerOrControls(name);
      renderChips(name);
      renderHistory(name);
    }

    function renderTableaus(name) {
      const dealKey = st.lastCard ? `${st.round}|${st.lastCard.user}|${JSON.stringify(st.lastCard.card)}` : null;
      const isFreshDeal = dealKey && dealKey !== lastDealKey;

      $('#ff-tableaus').innerHTML = st.players.map(u => {
        const line = st.lines[u];
        const sm = STATUS_META[line.status] || STATUS_META.active;
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        const av = sdk.avatarUrl(u);

        // The duplicate that just busted this line: mark it (and its earlier
        // twin already in `cards`) red instead of silently vanishing.
        const bustedNow = line.status === 'busted' && st.lastCard?.user === u
          && st.lastCard.card.kind === 'number';
        const dupValue = bustedNow ? st.lastCard.card.value : null;
        let dupMarked = false;
        const cardHtml = line.cards.map(c => {
          const isTwin = dupValue != null && !dupMarked && c.kind === 'number' && c.value === dupValue;
          if (isTwin) dupMarked = true;
          return cardFace(c, isTwin ? 'dup' : '');
        }).join('') + (bustedNow ? cardFace(st.lastCard.card, 'dup') : '');

        return `<div class="ff-tab ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''} ${line.status === 'busted' ? 'bust' : ''}" data-user="${u}">
          <div class="ff-plate">
            <div class="ff-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
            <div class="ff-tab-name">${name(u)}${u === me ? ' (you)' : ''}</div>
            <span class="ff-badge ${sm.cls}">${sm.label}</span>
          </div>
          <div class="ff-tab-cards" data-deal="${u === st.lastCard?.user ? dealKey : ''}">${cardHtml || '<span style="font-size:.68rem;color:var(--muted)">No flips yet</span>'}</div>
          <div class="ff-tab-foot">
            <span class="${line.flip7 ? 'ff-uniq f7' : 'ff-uniq'}">${line.numbers.length}/7${line.flip7 ? ' Flip 7!' : ''}</span>
            <span class="ff-score">${st.scores[u] ?? 0}</span>
          </div>
        </div>`;
      }).join('');

      if (isFreshDeal) {
        lastDealKey = dealKey;
        const holder = rootEl.querySelector(`.ff-tab-cards[data-deal="${window.CSS.escape(dealKey)}"]`);
        const target = holder?.lastElementChild;
        if (target) flyFromDeck(target);
      }
    }

    function renderPickerOrControls(name) {
      const picker = $('#ff-picker');
      const controls = $('#ff-controls');
      const wait = $('#ff-wait');
      picker.hidden = true; controls.innerHTML = ''; wait.textContent = '';

      if (st.winner) return;

      if (st.pending && st.pending.by === me) {
        const p = st.pending;
        let targets;
        if (p.type === 'givesecond') {
          targets = st.players.filter(u => u !== me && st.lines[u].status === 'active' && !st.lines[u].secondChance);
        } else {
          targets = st.players.filter(u => st.lines[u].status === 'active');
        }
        const meta = p.type === 'givesecond'
          ? { icon: 'secondchance', label: 'Hand off your extra Second Chance' }
          : ACTION_META[p.type];
        picker.hidden = false;
        picker.innerHTML = `
          <div class="ff-picker-title"><span class="ff-picon">${SPRITE[meta.icon] || ''}</span>${meta.label} — pick a target</div>
          <div class="ff-picker-opts">${targets.map(u =>
            `<button class="ff-btn" data-t="${u}">${name(u)}${u === me ? ' (you)' : ''}</button>`).join('')
            || '<span style="font-size:.78rem;color:var(--muted)">No eligible target — card is discarded.</span>'}</div>`;
        picker.querySelectorAll('[data-t]').forEach(b =>
          b.addEventListener('click', () => send({ action: 'resolve', target: b.dataset.t })));
        return;
      }
      if (st.pending) {
        wait.textContent = `Waiting for ${name(st.pending.by)} to resolve their card…`;
        return;
      }
      if (!myTurn()) {
        wait.textContent = `Waiting for ${name(st.turn)}…`;
        return;
      }
      const line = st.lines[me];
      controls.innerHTML = `
        <button id="ff-hit" class="ff-btn big">Flip</button>
        <button id="ff-stay" class="ff-btn stop" ${line.cards.length === 0 ? 'disabled' : ''}>Stay</button>`;
      $('#ff-hit').addEventListener('click', () => send({ action: 'hit' }));
      $('#ff-stay').addEventListener('click', () => send({ action: 'stay' }));
    }

    // ---- poker-chip-stack scoreboard ----
    function renderChips(name) {
      $('#ff-chips').innerHTML = st.players.map(u => {
        const sc = st.scores[u] ?? 0;
        const filled = Math.max(0, Math.min(CHIP_SLOTS, Math.round((sc / st.target) * CHIP_SLOTS)));
        const overflow = sc >= st.target;
        const chips = Array.from({ length: filled }, (_, k) =>
          `<span class="ff-chip-ic ${overflow && k === filled - 1 ? 'over' : ''}">${SPRITE.chip}</span>`).join('')
          || '<span style="font-size:.6rem;color:var(--muted);margin-left:2px">—</span>';
        const av = sdk.avatarUrl(u);
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        return `<div class="ff-chiprow ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}">
          <div class="ff-chip-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
          <div class="ff-chip-mid">
            <div class="ff-chip-name">${isWin ? '★ ' : ''}${name(u)}${u === me ? ' (you)' : ''}</div>
            <div class="ff-chip-stack">${chips}</div>
          </div>
          <span class="ff-chip-score">${sc}</span>
        </div>`;
      }).join('') + `<div class="ff-target">First to <b>${st.target}</b></div>`;
    }

    // ---- round history (completed rounds only) ----
    function renderHistory(name) {
      const el = $('#ff-hrows');
      if (!history.length) { el.innerHTML = `<div class="ff-empty">No rounds finished yet.</div>`; return; }
      el.innerHTML = history.map((h, i) => {
        const pills = h.summary.map(s => {
          const cls = s.busted ? 'bust' : (s.flip7 ? 'f7' : 'pos');
          const txt = s.busted ? `${sdk.nameOf(s.user)} bust` : `${sdk.nameOf(s.user)} +${s.points}`;
          return `<b class="${cls}">${txt}</b>`;
        }).join('');
        const detail = h.summary.map(s => {
          const cards = s.cards.map(c => cardFace(c)).join('') || '<span style="font-size:.65rem;color:var(--muted)">no cards</span>';
          const cls = s.busted ? 'bust' : (s.flip7 ? 'f7' : '');
          const label = s.busted ? 'BUST' : `+${s.points}${s.flip7 ? ' 7!' : ''}`;
          return `<div class="ff-hdetail-row">
            <span class="ff-hdetail-name">${sdk.nameOf(s.user)}</span>
            <div class="ff-hdetail-cards">${cards}</div>
            <span class="ff-hdetail-pts ${cls}">${label}</span>
          </div>`;
        }).join('');
        return `<div class="ff-hrow ${openHistoryIdx.has(i) ? 'open' : ''} ${i === 0 && h.fresh ? 'fresh' : ''}" data-i="${i}">
          <div class="ff-hsum"><span class="rn">R${h.round}</span><span class="pl">${pills}</span></div>
          <div class="ff-hdetail">${detail}</div>
        </div>`;
      }).join('');
      el.querySelectorAll('.ff-hrow').forEach(row => row.addEventListener('click', () => {
        const i = +row.dataset.i;
        openHistoryIdx.has(i) ? openHistoryIdx.delete(i) : openHistoryIdx.add(i);
        renderHistory(name);
      }));
    }

    // ---- round-summary / win overlay ----
    function hideSummary() {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer); summaryTimer = null;
      el.hidden = true; el.innerHTML = '';
    }
    function showRoundSummary(summary, round) {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer);
      const rows = summary.map((s, i) => {
        const cards = s.cards.map(c => cardFace(c)).join('');
        const cls = s.busted ? 'bust' : (s.flip7 ? 'f7' : '');
        const label = s.busted ? 'BUST — 0' : `${s.flip7 ? 'Flip 7! ' : ''}+${s.points}`;
        return `<div class="ff-sum-row" style="animation-delay:${(0.1 * i).toFixed(2)}s">
          <span class="ff-sum-name">${sdk.nameOf(s.user)}</span>
          <div class="ff-sum-cards">${cards || '<span style="font-size:.7rem;color:var(--muted)">no cards</span>'}</div>
          <span class="ff-sum-pts ${cls}">${label}</span>
        </div>`;
      }).join('');
      el.innerHTML = `<div class="ff-sum-panel">
        <div class="ff-sum-title">Round ${round} results</div>
        <div class="ff-sum-rows">${rows}</div>
        <div class="ff-sum-hint">tap to continue</div>
      </div>`;
      el.hidden = false;
      el.onclick = () => hideSummary();
      summaryTimer = setTimeout(hideSummary, 5000);
    }
    function showWinScreen(winner) {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer);
      const title = winner === 'draw' ? "It's a draw!" : `${sdk.nameOf(winner)} wins!`;
      el.innerHTML = `<div class="ff-sum-panel ff-win-panel">
        <div class="ff-win-icon">${SPRITE.star}</div>
        <div class="ff-win-title">${title}</div>
        <div class="ff-sum-hint">tap to dismiss</div>
      </div>`;
      el.hidden = false;
      el.onclick = () => hideSummary();
    }

    // ---- events ----
    const apply = s => {
      st = s;

      // Round History: append exactly one entry per completed round, derived
      // from roundSummary (no engine change — same field used for the
      // transient overlay). Never touched by individual flips.
      const rsKey = s.roundSummary ? `${s.round}|${s.winner ?? ''}|${JSON.stringify(s.roundSummary)}` : null;
      if (rsKey && rsKey !== prevRoundSummaryKey) {
        prevRoundSummaryKey = rsKey;
        const finishedRound = s.winner ? s.round : s.round - 1;
        history.unshift({ round: finishedRound, summary: s.roundSummary, fresh: true });
        if (history.length > 30) history.length = 30;
        showRoundSummary(s.roundSummary, finishedRound);
        if (s.winner) {
          clearTimeout(summaryTimer);
          summaryTimer = setTimeout(() => showWinScreen(s.winner), 4200);
        }
      }
      render();
      if (history[0]?.fresh) setTimeout(() => { history[0].fresh = false; }, 1200);
    };
    const onStarted      = e => apply(JSON.parse(e.state));
    const onMoved         = e => apply(JSON.parse(e.data));
    const onFinished      = e => apply(JSON.parse(e.state));
    const onRematched     = e => apply(JSON.parse(e.state));
    const onPrivateState  = e => apply(JSON.parse(e.data));
    const onError         = e => sdk.toast(e.message);

    sdk.on('started',      onStarted);
    sdk.on('moved',        onMoved);
    sdk.on('finished',     onFinished);
    sdk.on('rematched',    onRematched);
    sdk.on('privateState', onPrivateState);
    sdk.on('gameError',    onError);

    return () => {
      clearTimeout(summaryTimer);
      sdk.off('started',      onStarted);
      sdk.off('moved',        onMoved);
      sdk.off('finished',     onFinished);
      sdk.off('rematched',    onRematched);
      sdk.off('privateState', onPrivateState);
      sdk.off('gameError',    onError);
    };
  },
};
