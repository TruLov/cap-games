/**
 * Flip Fortune — Game UI ("Last Chance Saloon" theme).
 *
 * A Wild-West saloon card table, deliberately NOT the stage+sidebar skeleton the
 * other pixel games use. Everyone sits around one green-felt table under a warm
 * hanging lamp: opponents in an arc across the top, the deck + the last flipped
 * card in the felt's centre, and YOU at the bottom rail with your Flip / Stay
 * buttons. Scores live on each seat as a brass tally + poker-chip stack; a slim
 * ledger under the table keeps the round history.
 *
 * mount(rootEl, sdk) is called once the match is starting/active. The shell's
 * Players/Chat chrome is left untouched — every seat here already shows a
 * player's avatar, name and score.
 *
 * Kept from the previous build: the card flies from the deck to the flipping
 * seat's slot (FLIP transform), and a duplicate that busts a line is shown in
 * that seat (both twins pulse red) rather than silently vanishing.
 */

import { SPRITE } from './sprites.js';

const MOD_COLOR = { '+2': '#2f8f5e', '+4': '#2f8f5e', '+6': '#2f8f5e', '+8': '#2f8f5e', '+10': '#2f8f5e', x2: '#a8283a' };
const ACTION_META = {
  freeze: { icon: 'freeze', label: 'Freeze', color: '#6fd7f2' },
  flipthree: { icon: 'flipthree', label: 'Flip Three', color: '#d4a03c' },
  secondchance: { icon: 'secondchance', label: '2nd Chance', color: '#2f8f5e' },
};
const STATUS_META = {
  active: { label: 'In', cls: 'act' },
  stayed: { label: 'Stayed', cls: 'stay' },
  busted: { label: 'Bust', cls: 'bust' },
  frozen: { label: 'Frozen', cls: 'frz' },
};

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
    --felt:#1e5638; --felt-d:#123c26; --felt-l:#2a6b46;
    --wood:#5b3a1e; --wood-d:#3a2412; --wood-l:#7a4f2a;
    --brass:#d4a03c; --brass-d:#8a6420; --parch:#efe0be; --parch-d:#d8c390;
    --line:#1a0e06; --cream:#f4ead0; --muted:#c9b48f;
    --crimson:#c94636; --crimson-d:#7a1c18; --emerald:#4fd08a; --cyan:#6fd7f2; --amber:#ffcf7a;
    --pix:'Pixelify Sans', ui-monospace, "SFMono-Regular", "Courier New", monospace;
    position:relative; padding:16px 16px 14px; border-radius:14px; color:var(--cream);
    font-family:var(--pix);
    background:
      radial-gradient(120% 60% at 50% -6%, rgba(255,207,122,.16), rgba(0,0,0,0) 55%),
      repeating-linear-gradient(90deg, var(--wood) 0 30px, var(--wood-l) 30px 31px, var(--wood) 31px 61px),
      linear-gradient(180deg, var(--wood-d), #241608);
    box-shadow:inset 0 0 0 3px var(--wood-d), inset 0 0 120px rgba(0,0,0,.55), 0 12px 30px rgba(0,0,0,.45);
  }
  /* hanging lamp glow */
  .ff-lamp{position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:150px;height:26px;z-index:1;
    background:radial-gradient(60% 100% at 50% 0%, var(--amber), rgba(255,207,122,0) 70%);pointer-events:none}

  /* ---- the felt table ---- */
  .ff-felt{position:relative;z-index:1;border-radius:130px/70px;padding:18px 22px 14px;
    background:
      radial-gradient(120% 90% at 50% 12%, var(--felt-l) 0%, var(--felt) 45%, var(--felt-d) 100%);
    border:10px solid var(--wood);
    box-shadow:
      0 0 0 3px var(--wood-d), inset 0 0 0 4px var(--brass-d),
      inset 0 0 60px rgba(0,0,0,.5), 0 10px 26px rgba(0,0,0,.5);}
  .ff-felt::after{content:"";position:absolute;inset:6px;border-radius:120px/64px;pointer-events:none;
    box-shadow:inset 0 0 0 2px rgba(212,160,60,.35)}
  .ff-status{position:relative;z-index:2;text-align:center;font-weight:700;font-size:1rem;
    color:var(--amber);margin:0 0 10px;text-shadow:1px 1px 0 rgba(0,0,0,.6);letter-spacing:.02em}

  /* ---- seats ---- */
  .ff-opp-row{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;position:relative;z-index:2}
  .ff-seat{flex:0 1 auto;min-width:118px;max-width:180px;border-radius:10px;padding:.4rem .5rem .45rem;
    background:linear-gradient(180deg, rgba(10,30,20,.55), rgba(6,20,13,.66));
    border:2px solid var(--felt-d);box-shadow:inset 0 0 0 1px rgba(212,160,60,.12);
    transition:border-color .15s ease, box-shadow .15s ease}
  .ff-seat.act{border-color:var(--amber);box-shadow:0 0 0 2px rgba(255,207,122,.5), inset 0 0 22px rgba(255,207,122,.12)}
  .ff-seat.win{border-color:var(--emerald);box-shadow:0 0 0 2px rgba(79,208,138,.55)}
  .ff-seat.bust{filter:saturate(.7) brightness(.92)}
  .ff-seat.me{background:linear-gradient(180deg, rgba(20,50,34,.7), rgba(10,30,20,.8))}

  .ff-plate{display:flex;align-items:center;gap:.4rem;margin-bottom:.35rem}
  .ff-ava{flex:0 0 auto;width:24px;height:24px;border-radius:5px;background:var(--felt-d) center/cover;
    border:2px solid var(--brass-d);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--cream);font-size:.68rem}
  .ff-nm{flex:1;min-width:0;font-weight:700;font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ff-badge{flex:0 0 auto;font-size:.54rem;letter-spacing:.05em;text-transform:uppercase;font-weight:700;
    padding:1px 5px;border-radius:4px;border:1px solid var(--line);background:rgba(0,0,0,.35);color:var(--muted)}
  .ff-badge.act{background:var(--amber);color:#3a2400;border-color:var(--brass-d)}
  .ff-badge.stay{background:var(--emerald);color:#06231a}
  .ff-badge.bust{background:var(--crimson);color:#fff}
  .ff-badge.frz{background:var(--cyan);color:#052733}

  .ff-hand{display:flex;min-height:40px;align-items:center;padding-left:2px}
  .ff-hand .ff-card{margin-left:-20px}
  .ff-hand .ff-card:first-child{margin-left:0}
  .ff-hand.empty{color:var(--muted);font-size:.62rem;font-style:italic}
  .ff-2nd{margin-left:4px;width:18px;height:24px;flex:0 0 auto;filter:drop-shadow(0 0 3px rgba(79,208,138,.6))}

  .ff-foot{display:flex;justify-content:space-between;align-items:center;margin-top:.35rem;gap:6px}
  .ff-uniq{font-size:.62rem;font-weight:700;color:var(--brass)}
  .ff-uniq.f7{color:var(--emerald)}
  .ff-tally{display:flex;align-items:center;gap:3px}
  .ff-chip-ic{width:13px;height:13px;image-rendering:pixelated}
  .ff-chip-ic:not(:first-child){margin-left:-7px}
  .ff-score{font-weight:700;font-size:.86rem;color:var(--brass);text-shadow:1px 1px 0 var(--line)}

  /* ---- pixel card ---- */
  .ff-card{width:38px;height:52px;box-sizing:border-box;border:3px solid var(--line);border-radius:5px;
    background:var(--parch);display:flex;align-items:center;justify-content:center;position:relative;flex:0 0 auto;
    box-shadow:inset 2px 2px 0 rgba(255,255,255,.45), inset -2px -2px 0 rgba(0,0,0,.18), 1px 2px 0 rgba(0,0,0,.45)}
  .ff-card.num{border-color:var(--brass-d)}
  .ff-card.num .ff-num{font-weight:700;font-size:1.2rem;color:var(--felt-d)}
  .ff-card.mod{background:linear-gradient(180deg,#fff7e6,var(--accent));border-color:var(--accent)}
  .ff-card.mod .ff-mod{font-weight:700;font-size:.78rem;color:#1c1206}
  .ff-card.act{background:#20140a;border-color:var(--accent);
    box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent), 1px 2px 0 rgba(0,0,0,.45)}
  .ff-card.act .ff-icon{width:22px;height:22px}
  .ff-card.dup{animation:ff-dup 1s ease-in-out 2;border-color:var(--crimson) !important;
    box-shadow:0 0 0 2px var(--crimson), 1px 2px 0 rgba(0,0,0,.45)}
  @keyframes ff-dup{0%,100%{filter:none}50%{filter:brightness(.7) saturate(1.7)}}
  .ff-flying{position:fixed;z-index:60;pointer-events:none;will-change:transform,opacity}

  /* ---- centre: deck + last flip + round ---- */
  .ff-center{display:flex;align-items:center;justify-content:center;gap:22px;position:relative;z-index:2;
    margin:12px 0 8px;padding:10px 0;border-top:2px dashed rgba(212,160,60,.25);border-bottom:2px dashed rgba(212,160,60,.25)}
  .ff-deckwrap{display:flex;flex-direction:column;align-items:center;gap:3px}
  .ff-deck{width:50px;height:50px;filter:drop-shadow(0 4px 0 rgba(0,0,0,.5))}
  .ff-deck svg{width:100%;height:100%}
  .ff-deckcount{font-size:.6rem;color:var(--parch-d);letter-spacing:.04em}
  .ff-lastwrap{display:flex;flex-direction:column;align-items:center;gap:5px;min-width:64px}
  .ff-lastcard{transform:scale(1.15)}
  .ff-lastlabel{font-size:.62rem;color:var(--muted);text-align:center;max-width:120px}
  .ff-round{display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--amber)}
  .ff-round b{font-size:1.35rem;font-weight:700;text-shadow:1px 1px 0 rgba(0,0,0,.6)}
  .ff-round span{font-size:.56rem;letter-spacing:.14em;text-transform:uppercase;color:var(--parch-d)}

  /* ---- your rail ---- */
  .ff-you-row{display:flex;justify-content:center;position:relative;z-index:2;margin-top:2px}
  .ff-you-row .ff-seat{min-width:230px;max-width:none;flex:0 1 480px}
  .ff-you-row .ff-hand .ff-card{margin-left:-12px}
  .ff-you-row .ff-hand{min-height:56px}
  .ff-you-row .ff-card{width:42px;height:58px}
  .ff-you-row .ff-card.num .ff-num{font-size:1.35rem}

  /* ---- action bar (Flip / Stay / picker) ---- */
  .ff-actionbar{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:12px}
  .ff-controls{display:flex;gap:.7rem}
  .ff-btn{font-family:var(--pix);font-weight:700;font-size:.98rem;letter-spacing:.02em;
    color:#3a2400;border:3px solid var(--line);border-radius:9px;padding:.55rem 1.4rem;cursor:pointer;
    background:linear-gradient(180deg,#f0d488,var(--brass));
    box-shadow:inset 0 2px 0 rgba(255,255,255,.5), 0 4px 0 var(--brass-d);
    transition:transform .08s ease, box-shadow .08s ease}
  .ff-btn:hover:not(:disabled){filter:brightness(1.06)}
  .ff-btn:active:not(:disabled){transform:translateY(4px);box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 0 0 var(--brass-d)}
  .ff-btn:disabled{opacity:.4;cursor:not-allowed}
  .ff-btn.stop{color:#fff;background:linear-gradient(180deg,#e0685a,var(--crimson));box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 4px 0 var(--crimson-d)}
  .ff-btn.stop:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--crimson-d)}
  .ff-picker{border:3px solid var(--brass);border-radius:11px;padding:.6rem .7rem;background:rgba(0,0,0,.4);max-width:520px}
  .ff-picker-title{font-size:.8rem;font-weight:700;color:var(--amber);margin-bottom:.5rem;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px}
  .ff-picker-title .ff-picon{width:18px;height:18px}
  .ff-picker-opts{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center}
  .ff-picker .ff-btn{padding:.4rem .9rem;font-size:.85rem}
  .ff-wait{font-size:.82rem;color:var(--muted);text-align:center}

  /* ---- ledger (round history) ---- */
  .ff-ledger{position:relative;z-index:1;margin-top:12px;display:flex;align-items:center;gap:8px;
    padding:.5rem .6rem;border-radius:10px;background:rgba(0,0,0,.34);border:2px solid var(--wood-d);
    overflow-x:auto}
  .ff-ledger h4{margin:0;flex:0 0 auto;font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
  .ff-ledger .ff-empty{font-size:.7rem;color:var(--muted)}
  .ff-lpill{flex:0 0 auto;cursor:pointer;font-size:.66rem;padding:3px 8px;border-radius:6px;
    background:rgba(212,160,60,.12);border:1px solid var(--brass-d);color:var(--parch);white-space:nowrap}
  .ff-lpill:hover{background:rgba(212,160,60,.24)}
  .ff-lpill b{color:var(--amber)}
  .ff-lpill.fresh{animation:ff-hflash 1.1s ease}
  @keyframes ff-hflash{0%{background:rgba(255,207,122,.5)}100%{background:rgba(212,160,60,.12)}}

  /* ---- round-summary / win overlay (saloon notice) ---- */
  .ff-summary{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;
    background:rgba(10,6,2,.82);border-radius:14px;cursor:pointer;animation:ff-fadein .2s ease;overflow:auto;padding:12px}
  .ff-summary[hidden]{display:none}
  @keyframes ff-fadein{from{opacity:0}to{opacity:1}}
  .ff-notice{min-width:280px;max-width:94%;border-radius:6px;padding:16px 20px 18px;color:#2a1a0c;
    background:
      radial-gradient(120% 80% at 50% 0%, #fbf1d6, var(--parch) 70%);
    border:3px solid var(--wood-d);
    box-shadow:0 0 0 3px var(--parch-d), 0 16px 44px rgba(0,0,0,.6), inset 0 0 40px rgba(120,80,30,.18);
    animation:ff-slam .4s cubic-bezier(.2,1.3,.5,1)}
  @keyframes ff-slam{0%{transform:translateY(-30px) rotate(-2deg);opacity:0}60%{transform:translateY(3px) rotate(1deg);opacity:1}100%{transform:none}}
  .ff-notice-title{text-align:center;font-weight:700;font-size:1.15rem;color:#6a3d12;margin-bottom:2px;letter-spacing:.04em}
  .ff-notice-sub{text-align:center;font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;color:#9a7038;margin-bottom:12px}
  .ff-sum-rows{display:flex;flex-direction:column;gap:7px}
  .ff-sum-row{display:flex;align-items:center;gap:8px;border-bottom:1px dashed rgba(106,61,18,.35);padding-bottom:6px;
    animation:ff-linein .3s ease backwards}
  .ff-sum-row:last-child{border-bottom:none}
  @keyframes ff-linein{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
  .ff-sum-name{flex:0 0 84px;font-weight:700;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3a2410}
  .ff-sum-cards{display:flex;gap:2px;flex:1;min-width:0;flex-wrap:wrap}
  .ff-sum-cards .ff-card{width:24px;height:33px}
  .ff-sum-cards .ff-card.num .ff-num{font-size:.8rem}
  .ff-sum-cards .ff-icon{width:14px;height:14px}
  .ff-sum-pts{flex:0 0 auto;font-weight:700;min-width:56px;text-align:right;color:#2f6a44}
  .ff-sum-pts.bust{color:var(--crimson-d)}
  .ff-sum-pts.f7{color:#1f7a48}
  .ff-notice-hint{text-align:center;font-size:.6rem;color:#9a7038;margin-top:12px;letter-spacing:.1em}
  .ff-win-title{font-size:1.7rem;color:#6a3d12;text-align:center;font-weight:700;margin:2px 0 4px}
  .ff-win-icon{width:60px;height:60px;margin:0 auto 6px}

  @media (prefers-reduced-motion: reduce){
    .ff-flying,.ff-card.dup,.ff-summary,.ff-notice,.ff-sum-row,.ff-lpill.fresh{animation:none}
  }
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let st = null;
    let history = [];          // one entry per completed round (from roundSummary)
    let lastDealKey = null;    // dedupe the fly-in animation trigger
    let summaryTimer = null;
    let prevRoundSummaryKey = null;

    rootEl.innerHTML = `<div class="ff-root">
      <style>${STYLE}</style>
      <div class="ff-lamp"></div>
      <div class="ff-felt">
        <div class="ff-status" id="ff-status">Loading…</div>
        <div class="ff-opp-row" id="ff-opps"></div>
        <div class="ff-center">
          <div class="ff-deckwrap">
            <div class="ff-deck" id="ff-deck">${SPRITE.deckstack}</div>
            <div class="ff-deckcount" id="ff-deckcount"></div>
          </div>
          <div class="ff-lastwrap">
            <div class="ff-lastcard" id="ff-lastcard"></div>
            <div class="ff-lastlabel" id="ff-lastlabel"></div>
          </div>
          <div class="ff-round"><b id="ff-roundno">1</b><span>Round</span></div>
        </div>
        <div class="ff-you-row" id="ff-you"></div>
      </div>
      <div class="ff-actionbar">
        <div class="ff-picker" id="ff-picker" hidden></div>
        <div class="ff-controls" id="ff-controls"></div>
        <div class="ff-wait" id="ff-wait"></div>
      </div>
      <div class="ff-ledger" id="ff-ledger"></div>
      <div class="ff-summary" id="ff-summary" hidden></div>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && st.phase !== 'done' && st.turn === me && !st.pending;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });

    // card flies from the deck to the just-dealt seat slot (FLIP)
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
      ghost.style.margin = '0';
      ghost.style.transform = 'scale(.6) rotate(-12deg)';
      ghost.style.opacity = '0.35';
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

    // one seat (opponent or you)
    function seatHtml(u, dealKey) {
      const name = sdk.nameOf(u);
      const line = st.lines[u];
      const sm = STATUS_META[line.status] || STATUS_META.active;
      const isTurn = u === st.turn && st.phase !== 'done';
      const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
      const av = sdk.avatarUrl(u);

      // duplicate that just busted this line → show it (and its twin) in red
      const bustedNow = line.status === 'busted' && st.lastCard?.user === u && st.lastCard.card.kind === 'number';
      const dupValue = bustedNow ? st.lastCard.card.value : null;
      let dupMarked = false;
      const cardsHtml = line.cards.map(c => {
        const isTwin = dupValue != null && !dupMarked && c.kind === 'number' && c.value === dupValue;
        if (isTwin) dupMarked = true;
        return cardFace(c, isTwin ? 'dup' : '');
      }).join('') + (bustedNow ? cardFace(st.lastCard.card, 'dup') : '');

      const chips = Math.max(0, Math.min(6, Math.round(((st.scores[u] ?? 0) / st.target) * 6)));
      const chipStack = Array.from({ length: chips }, () => `<span class="ff-chip-ic">${SPRITE.chip}</span>`).join('');
      const secondIc = line.secondChance ? `<span class="ff-2nd">${SPRITE.secondchance}</span>` : '';

      return `<div class="ff-seat ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''} ${line.status === 'busted' ? 'bust' : ''} ${u === me ? 'me' : ''}">
        <div class="ff-plate">
          <div class="ff-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name[0] || '?').toUpperCase()}</div>
          <div class="ff-nm">${name}${u === me ? ' (you)' : ''}</div>
          <span class="ff-badge ${sm.cls}">${sm.label}</span>
        </div>
        <div class="ff-hand ${line.cards.length ? '' : 'empty'}" data-deal="${u === st.lastCard?.user ? dealKey : ''}">${cardsHtml || 'no cards yet'}${secondIc}</div>
        <div class="ff-foot">
          <span class="ff-uniq ${line.flip7 ? 'f7' : ''}">${line.numbers.length}/7${line.flip7 ? ' · FLIP 7!' : ''}</span>
          <span class="ff-tally">${chipStack}<span class="ff-score">${st.scores[u] ?? 0}</span></span>
        </div>
      </div>`;
    }

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#ff-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'The pot is split — a draw!' : `${name(st.winner)} takes the pot!`)
        : (st.pending
            ? (st.pending.by === me ? 'Your action card — call your shot.' : `${name(st.pending.by)} is calling a shot…`)
            : (myTurn() ? 'Your deal — Flip or Stay.' : `Waiting on ${name(st.turn)}…`));

      const dealKey = st.lastCard ? `${st.round}|${st.lastCard.user}|${JSON.stringify(st.lastCard.card)}` : '';
      const opponents = st.players.filter(u => u !== me);
      $('#ff-opps').innerHTML = opponents.map(u => seatHtml(u, dealKey)).join('');
      $('#ff-you').innerHTML = st.players.includes(me) ? seatHtml(me, dealKey) : '';

      $('#ff-deckcount').textContent = `${st.drawCount ?? 0} left`;
      $('#ff-roundno').textContent = st.round;
      $('#ff-lastcard').innerHTML = st.lastCard ? `<div class="ff-lastcard-inner">${cardFace(st.lastCard.card)}</div>` : '';
      $('#ff-lastlabel').innerHTML = st.lastCard
        ? `<b>${name(st.lastCard.user)}</b> flipped ${cardLabel(st.lastCard.card)}`
        : 'Awaiting the first flip';

      // fly the freshly dealt card from the deck into its seat slot
      if (dealKey && dealKey !== lastDealKey) {
        lastDealKey = dealKey;
        const holder = rootEl.querySelector(`.ff-hand[data-deal="${window.CSS.escape(dealKey)}"]`);
        const cards = holder ? holder.querySelectorAll('.ff-card') : [];
        const target = cards.length ? cards[cards.length - 1] : null;
        if (target) flyFromDeck(target);
      }

      renderPickerOrControls(name);
      renderLedger();
    }

    function renderPickerOrControls(name) {
      const picker = $('#ff-picker');
      const controls = $('#ff-controls');
      const wait = $('#ff-wait');
      picker.hidden = true; controls.innerHTML = ''; wait.textContent = '';
      if (st.winner) return;

      if (st.pending && st.pending.by === me) {
        const p = st.pending;
        const targets = p.type === 'givesecond'
          ? st.players.filter(u => u !== me && st.lines[u].status === 'active' && !st.lines[u].secondChance)
          : st.players.filter(u => st.lines[u].status === 'active');
        const meta = p.type === 'givesecond'
          ? { icon: 'secondchance', label: 'Hand off your spare Second Chance' }
          : ACTION_META[p.type];
        picker.hidden = false;
        picker.innerHTML = `
          <div class="ff-picker-title"><span class="ff-picon">${SPRITE[meta.icon] || ''}</span>${meta.label} — pick a target</div>
          <div class="ff-picker-opts">${targets.map(u =>
            `<button class="ff-btn" data-t="${u}">${name(u)}${u === me ? ' (you)' : ''}</button>`).join('')
            || '<span class="ff-wait">No eligible target — the card is discarded.</span>'}</div>`;
        picker.querySelectorAll('[data-t]').forEach(b =>
          b.addEventListener('click', () => send({ action: 'resolve', target: b.dataset.t })));
        return;
      }
      if (st.pending) { wait.textContent = `Waiting for ${name(st.pending.by)} to resolve their card…`; return; }
      if (!myTurn()) { wait.textContent = `Waiting on ${name(st.turn)}…`; return; }

      const line = st.lines[me];
      controls.innerHTML = `
        <button id="ff-hit" class="ff-btn">Flip</button>
        <button id="ff-stay" class="ff-btn stop" ${line.cards.length === 0 ? 'disabled' : ''}>Stay</button>`;
      $('#ff-hit').addEventListener('click', () => send({ action: 'hit' }));
      $('#ff-stay').addEventListener('click', () => send({ action: 'stay' }));
    }

    function renderLedger() {
      const el = $('#ff-ledger');
      if (!history.length) { el.innerHTML = `<h4>Ledger</h4><span class="ff-empty">No rounds settled yet.</span>`; return; }
      el.innerHTML = `<h4>Ledger</h4>` + history.map((h, i) => {
        const top = [...h.summary].sort((a, b) => b.points - a.points)[0];
        const tag = top && top.points > 0 ? `${sdk.nameOf(top.user)} +${top.points}` : 'no score';
        return `<span class="ff-lpill ${i === 0 && h.fresh ? 'fresh' : ''}" data-i="${i}"><b>R${h.round}</b> ${tag}</span>`;
      }).join('');
      el.querySelectorAll('.ff-lpill').forEach(p =>
        p.addEventListener('click', () => { const h = history[+p.dataset.i]; showRoundSummary(h.summary, h.round, true); }));
    }

    // ---- round-summary / win overlay ----
    function hideSummary() {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer); summaryTimer = null;
      el.hidden = true; el.innerHTML = '';
    }
    function showRoundSummary(summary, round, sticky = false) {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer);
      const rows = [...summary].sort((a, b) => b.points - a.points).map((s, i) => {
        const cards = s.cards.map(c => cardFace(c)).join('');
        const cls = s.busted ? 'bust' : (s.flip7 ? 'f7' : '');
        const label = s.busted ? 'BUST · 0' : `${s.flip7 ? 'FLIP 7 · ' : ''}+${s.points}`;
        return `<div class="ff-sum-row" style="animation-delay:${(0.08 * i).toFixed(2)}s">
          <span class="ff-sum-name">${sdk.nameOf(s.user)}</span>
          <div class="ff-sum-cards">${cards || '<span style="font-size:.65rem;color:#9a7038">no cards</span>'}</div>
          <span class="ff-sum-pts ${cls}">${label}</span>
        </div>`;
      }).join('');
      el.innerHTML = `<div class="ff-notice">
        <div class="ff-notice-title">Round ${round}</div>
        <div class="ff-notice-sub">Saloon Tally</div>
        <div class="ff-sum-rows">${rows}</div>
        <div class="ff-notice-hint">tap to continue</div>
      </div>`;
      el.hidden = false;
      el.onclick = hideSummary;
      if (!sticky) summaryTimer = setTimeout(hideSummary, 5000);
    }
    function showWinScreen(winner) {
      const el = $('#ff-summary');
      clearTimeout(summaryTimer);
      const title = winner === 'draw' ? 'The pot is split!' : `${sdk.nameOf(winner)} wins the pot!`;
      el.innerHTML = `<div class="ff-notice ff-win-panel">
        <div class="ff-win-icon">${SPRITE.star}</div>
        <div class="ff-win-title">${title}</div>
        <div class="ff-notice-hint">tap to dismiss</div>
      </div>`;
      el.hidden = false;
      el.onclick = hideSummary;
    }

    // ---- events ----
    const apply = s => {
      st = s;
      const rsKey = s.roundSummary ? `${s.round}|${s.winner ?? ''}|${JSON.stringify(s.roundSummary)}` : null;
      if (rsKey && rsKey !== prevRoundSummaryKey) {
        prevRoundSummaryKey = rsKey;
        const finishedRound = s.winner ? s.round : s.round - 1;
        history.unshift({ round: finishedRound, summary: s.roundSummary, fresh: true });
        if (history.length > 30) history.length = 30;
        showRoundSummary(s.roundSummary, finishedRound);
        if (s.winner) { clearTimeout(summaryTimer); summaryTimer = setTimeout(() => showWinScreen(s.winner), 4200); }
      }
      render();
      if (history[0]?.fresh) setTimeout(() => { if (history[0]) history[0].fresh = false; }, 1300);
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
