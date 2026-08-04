/**
 * Flip Fortune — Game UI (Balatro-style pixel look, matching Kaperfahrt).
 *
 * mount(rootEl, sdk) — called once the match is starting/active. The stage
 * shows the shared table: every player's tableau (their flipped cards, unique
 * count toward Flip 7, status), the last flipped card with a flip-in reveal,
 * and — only for the active player — Hit/Stay controls or a target picker for
 * a pending action card (Freeze / Flip Three / hand off a second Second
 * Chance). The rail holds the scoreboard (target progress) and a viewer-local
 * flip log (never touches state — just remembers recent `lastCard` events).
 *
 * Like Kaperfahrt, this panel owns a fixed dark palette (`.ff-root` custom
 * properties) and the Pixelify Sans font, independent of the shell's theme.
 * All game state is public here (privateState === publicState — the only
 * hidden thing is draw-pile order, already stripped server-side to a count).
 */

import { SPRITE } from './sprites.js';

const MOD_COLOR = { '+2': '#3ecf8e', '+4': '#3ecf8e', '+6': '#3ecf8e', '+8': '#3ecf8e', '+10': '#3ecf8e', x2: '#8b5cf6' };
const ACTION_META = {
  freeze: { icon: 'freeze', label: 'Freeze', color: '#6fd7f2' },
  flipthree: { icon: 'flipthree', label: 'Flip Three', color: '#f5c542' },
  secondchance: { icon: 'secondchance', label: '2nd Chance', color: '#3ecf8e' },
};
const STATUS_META = {
  active: { label: 'In play', cls: 'act' },
  stayed: { label: 'Stayed', cls: 'stay' },
  busted: { label: 'Busted', cls: 'bust' },
  frozen: { label: 'Frozen', cls: 'frz' },
};

function cardFace(c) {
  if (!c) return '';
  if (c.kind === 'number') return `<div class="ff-card num"><span class="ff-num">${c.value}</span></div>`;
  if (c.kind === 'modifier') {
    return `<div class="ff-card mod" style="--accent:${MOD_COLOR[c.mod]}"><span class="ff-mod">${c.mod === 'x2' ? '×2' : c.mod}</span></div>`;
  }
  const m = ACTION_META[c.action] || { icon: '', label: c.action, color: '#f5c542' };
  return `<div class="ff-card act" style="--accent:${m.color}"><span class="ff-icon">${SPRITE[m.icon] || ''}</span></div>`;
}

const STYLE = `
  @font-face{font-family:'Pixelify Sans';src:url('./pixelify.ttf') format('truetype');font-weight:400 700;font-display:swap}

  .ff-root{
    --ink:#14152a; --ink2:#20223f; --panel:#2b2d52; --panel2:#343869;
    --key:#565a9c; --line:#0e0f24; --cream:#f4efe1; --muted:#a6a7d0;
    --blue:#3b7dd8; --blue-d:#22508f; --red:#e5484d; --red-d:#9d2b2f;
    --gold:#f5c542; --gold-d:#b0821a; --green:#3ecf8e; --green-d:#1e8a5b;
    --cyan:#6fd7f2; --cyan-d:#2b8ba8; --purple:#8b5cf6; --purple-d:#5a34c0;
    --pix:'Pixelify Sans', ui-monospace, "SFMono-Regular", "Courier New", monospace;
    display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;
    position:relative; padding:16px; border-radius:18px; color:var(--cream);
    font-family:var(--pix);
    background:radial-gradient(120% 90% at 50% -10%, #1c3d2f 0%, #16281f 45%, #0f1a15 100%);
    box-shadow:inset 0 0 0 2px #2f5a45, inset 0 0 90px rgba(0,0,0,.55), 0 12px 30px rgba(0,0,0,.4);
  }

  /* ---- felt table stage ---- */
  .ff-stage{position:relative;flex:1 1 420px;min-width:300px;border-radius:14px;padding:14px 12px 12px;
    background:radial-gradient(120% 95% at 50% -10%, #1e4735 0%, #14251c 55%, #0d1712 100%);
    box-shadow:inset 0 0 0 2px rgba(62,207,142,.15)}
  .ff-status{font-weight:700;font-size:1.1rem;letter-spacing:.02em;margin:2px 4px 10px;text-shadow:2px 2px 0 var(--line)}

  .ff-deckrow{display:flex;align-items:center;gap:14px;margin:0 4px 12px}
  .ff-deck{position:relative;width:44px;height:60px;border-radius:5px;flex:0 0 auto;image-rendering:pixelated}
  .ff-deck svg{width:100%;height:100%}
  .ff-deck::after{content:attr(data-count);position:absolute;left:0;right:0;bottom:-16px;text-align:center;
    font-size:.62rem;color:var(--muted)}
  .ff-reveal{position:relative;width:60px;height:82px;flex:0 0 auto}
  .ff-reveal .ff-card{width:60px;height:82px;font-size:1.6rem}
  .ff-reveal .ff-icon{width:34px;height:34px}
  .ff-reveal-who{font-size:.72rem;color:var(--muted);min-width:0}
  .ff-reveal-who b{color:var(--cream)}
  .ff-flip{animation:ff-flip .4s ease-out}
  @keyframes ff-flip{0%{transform:rotateY(90deg) scale(.8);opacity:0}60%{transform:rotateY(-8deg) scale(1.08)}100%{transform:none;opacity:1}}

  /* ---- pixel card ---- */
  .ff-card{width:42px;height:58px;box-sizing:border-box;border:3px solid var(--line);border-radius:5px;
    background:#f4efe1;display:flex;align-items:center;justify-content:center;position:relative;
    box-shadow:inset 2px 2px 0 rgba(255,255,255,.6), inset -2px -2px 0 rgba(0,0,0,.12), 2px 3px 0 rgba(0,0,0,.35)}
  .ff-card.num .ff-num{font-weight:700;font-size:1.3rem;color:var(--ink);text-shadow:1px 1px 0 rgba(0,0,0,.1)}
  .ff-card.mod{background:linear-gradient(180deg,#fff,var(--accent));}
  .ff-card.mod .ff-mod{font-weight:700;font-size:.85rem;color:var(--ink)}
  .ff-card.act{background:var(--ink2);border-color:var(--accent);
    box-shadow:inset 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent), 2px 3px 0 rgba(0,0,0,.35)}
  .ff-card.act .ff-icon{width:26px;height:26px}
  .ff-card.back{background:transparent;border:none;box-shadow:none;padding:0}
  .ff-card.back svg{width:100%;height:100%}
  .ff-card.new{animation:ff-deal .28s ease-out}
  @keyframes ff-deal{0%{transform:translateY(-14px) scale(.7);opacity:0}100%{transform:none;opacity:1}}

  /* ---- player tableaus ---- */
  .ff-tableaus{display:flex;flex-wrap:wrap;gap:10px;margin:0 2px}
  .ff-tab{flex:1 1 220px;min-width:200px;border:3px solid var(--line);border-radius:12px;padding:.6rem .65rem;
    background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(0,0,0,.12));
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.05);transition:box-shadow .15s ease,border-color .15s ease}
  .ff-tab.act{border-color:var(--blue);box-shadow:0 0 0 2px rgba(59,125,216,.5)}
  .ff-tab.win{border-color:var(--gold);box-shadow:0 0 0 2px rgba(245,197,66,.6)}
  .ff-tab-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}
  .ff-ava{flex:0 0 auto;width:28px;height:28px;border-radius:6px;background:var(--panel2) center/cover;
    border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--cream);font-size:.78rem}
  .ff-tab-name{flex:1;min-width:0;font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ff-badge{font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;font-weight:700;padding:2px 7px;
    border-radius:6px;border:2px solid var(--line);background:var(--ink2);color:var(--muted)}
  .ff-badge.act{background:var(--blue);color:#fff}
  .ff-badge.stay{background:var(--green);color:#06231a}
  .ff-badge.bust{background:var(--red);color:#fff}
  .ff-badge.frz{background:var(--cyan);color:#06232a}
  .ff-tab-cards{display:flex;flex-wrap:wrap;gap:4px;min-height:58px}
  .ff-tab-foot{display:flex;justify-content:space-between;align-items:center;margin-top:.5rem;font-size:.7rem;color:var(--muted)}
  .ff-uniq{font-weight:700;color:var(--gold)}
  .ff-uniq.f7{color:var(--green)}
  .ff-score{font-weight:700;font-size:.95rem;color:var(--gold);text-shadow:1px 1px 0 var(--line)}

  /* ---- controls / target picker ---- */
  .ff-controls{display:flex;flex-wrap:wrap;gap:.6rem;margin:.9rem 4px .2rem}
  .ff-btn{font-family:var(--pix);font-weight:700;font-size:.95rem;letter-spacing:.02em;
    color:var(--cream);border:3px solid var(--line);border-radius:9px;padding:.5rem 1.05rem;
    cursor:pointer;background:var(--blue);
    box-shadow:inset 0 2px 0 rgba(255,255,255,.25), 0 4px 0 var(--blue-d);
    transition:transform .08s ease, box-shadow .08s ease}
  .ff-btn:hover:not(:disabled){filter:brightness(1.08)}
  .ff-btn:active:not(:disabled){transform:translateY(4px);box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--blue-d)}
  .ff-btn:disabled{opacity:.45;cursor:not-allowed}
  .ff-btn.big{font-size:1.05rem;padding:.55rem 1.1rem}
  .ff-btn.stop{background:var(--red);box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 4px 0 var(--red-d)}
  .ff-btn.stop:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--red-d)}
  .ff-picker{border:3px solid var(--gold);border-radius:12px;padding:.65rem .7rem;margin:.8rem 4px .2rem;
    background:rgba(245,197,66,.1)}
  .ff-picker-title{font-size:.78rem;font-weight:700;color:var(--gold);margin-bottom:.5rem;display:flex;align-items:center;gap:6px}
  .ff-picker-title .ff-picon{width:18px;height:18px}
  .ff-picker-opts{display:flex;flex-wrap:wrap;gap:.5rem}
  .ff-wait{font-size:.82rem;color:var(--muted);margin:.9rem 4px .2rem}

  /* ---- rail: scoreboard + log ---- */
  .ff-rail{flex:0 0 250px;min-width:220px;display:flex;flex-direction:column;gap:12px}
  .ff-side{border:3px solid var(--line);border-radius:14px;padding:.7rem;
    background:linear-gradient(180deg,var(--panel),#242648);box-shadow:inset 0 0 0 2px var(--key)}
  .ff-side h3,.ff-log h3{margin:.1rem 0 .6rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:center}
  .ff-player{display:flex;align-items:center;gap:.55rem;padding:.5rem .55rem;border-radius:10px;margin-bottom:.5rem;
    background:var(--ink2);border:2px solid var(--line);box-shadow:inset 0 0 0 2px rgba(255,255,255,.04)}
  .ff-player:last-child{margin-bottom:0}
  .ff-player.act{border-color:var(--blue);box-shadow:0 0 0 2px rgba(59,125,216,.45)}
  .ff-player.win{border-color:var(--gold);box-shadow:0 0 0 2px rgba(245,197,66,.5)}
  .ff-pinfo{flex:1;min-width:0}
  .ff-ptop{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}
  .ff-pname{font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ff-pscore{font-weight:700;font-size:.95rem;color:var(--gold);text-shadow:1px 1px 0 var(--line)}
  .ff-bar{display:flex;gap:2px;margin-top:.4rem}
  .ff-seg{flex:1;height:8px;border-radius:1px;background:rgba(255,255,255,.08)}
  .ff-seg.on{background:var(--green);box-shadow:0 0 4px rgba(62,207,142,.6)}
  .ff-target{font-size:.68rem;color:var(--muted);text-align:center;margin-top:.5rem}
  .ff-target b{color:var(--gold)}

  .ff-log{border:3px solid var(--line);border-radius:14px;padding:.6rem .5rem;
    background:var(--ink2);box-shadow:inset 0 0 0 2px var(--key);max-height:210px;overflow-y:auto}
  .ff-log .ff-empty{font-size:.72rem;color:var(--muted);text-align:center;padding:.4rem 0}
  .ff-logrow{display:flex;align-items:center;gap:6px;padding:5px 3px;border-bottom:1px solid rgba(255,255,255,.06);font-size:.72rem}
  .ff-logrow:last-child{border-bottom:none}
  .ff-logrow.flash{animation:ff-logflash .8s ease}
  @keyframes ff-logflash{0%{background:rgba(245,197,66,.55)}100%{background:transparent}}
  .ff-lognm{flex:0 0 auto;width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
  .ff-logcard{flex:0 0 auto;width:20px;height:26px;image-rendering:pixelated}
  .ff-logtxt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* ---- round-summary overlay ---- */
  .ff-summary{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
    background:rgba(8,9,20,.82);border-radius:18px;cursor:pointer;animation:ff-fadein .2s ease;overflow:auto;padding:10px}
  .ff-summary[hidden]{display:none}
  @keyframes ff-fadein{from{opacity:0}to{opacity:1}}
  .ff-sum-panel{min-width:280px;max-width:92%;border:4px solid var(--line);border-radius:16px;padding:16px 20px;
    background:linear-gradient(180deg,var(--panel2),var(--panel));
    box-shadow:inset 0 0 0 2px var(--key),0 16px 44px rgba(0,0,0,.55);animation:ff-slam .4s cubic-bezier(.2,1.3,.5,1)}
  @keyframes ff-slam{0%{transform:translateY(-30px) rotate(-3deg);opacity:0}60%{transform:translateY(3px) rotate(1deg);opacity:1}100%{transform:none}}
  .ff-sum-title{text-align:center;font-weight:700;font-size:1.1rem;color:var(--gold);margin-bottom:12px;text-shadow:1px 1px 0 var(--line)}
  .ff-sum-rows{display:flex;flex-direction:column;gap:8px}
  .ff-sum-row{display:flex;align-items:center;gap:8px;border:2px solid var(--line);border-radius:9px;padding:6px 8px;
    background:rgba(255,255,255,.04);animation:ff-linein .3s ease backwards}
  @keyframes ff-linein{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
  .ff-sum-name{flex:0 0 90px;font-weight:700;font-size:.8rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ff-sum-cards{display:flex;flex-wrap:wrap;gap:3px;flex:1;min-width:0}
  .ff-sum-cards .ff-card{width:26px;height:36px;font-size:.72rem}
  .ff-sum-cards .ff-icon{width:16px;height:16px}
  .ff-sum-pts{flex:0 0 auto;font-weight:700;min-width:52px;text-align:right}
  .ff-sum-pts.bust{color:var(--red)}
  .ff-sum-pts.f7{color:var(--green)}
  .ff-sum-hint{text-align:center;font-size:.64rem;color:var(--muted);margin-top:12px;letter-spacing:.08em}
  .ff-win-panel{text-align:center}
  .ff-win-title{font-size:1.6rem;font-weight:700;color:var(--gold);text-shadow:2px 2px 0 var(--line);margin-bottom:8px}
  .ff-win-icon{width:64px;height:64px;margin:0 auto 8px}

  @media (prefers-reduced-motion: reduce){
    .ff-flip,.ff-card.new,.ff-summary,.ff-sum-panel,.ff-sum-row{animation:none}
  }
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let st = null;
    let log = [];              // viewer-local: recent lastCard flips (never in state)
    let lastCardKey = null;
    let summaryTimer = null;

    rootEl.innerHTML = `<div class="ff-root"><style>${STYLE}</style>
      <div class="ff-stage" id="ff-stage">
        <div class="ff-status" id="ff-status">Loading…</div>
        <div class="ff-deckrow">
          <div class="ff-deck" id="ff-deck">${SPRITE.cardback}</div>
          <div class="ff-reveal" id="ff-reveal"></div>
          <div class="ff-reveal-who" id="ff-revealwho"></div>
        </div>
        <div class="ff-tableaus" id="ff-tableaus"></div>
        <div class="ff-picker" id="ff-picker" hidden></div>
        <div class="ff-controls" id="ff-controls"></div>
        <div class="ff-wait" id="ff-wait"></div>
      </div>
      <aside class="ff-rail">
        <div class="ff-side"><h3>Scoreboard</h3><div id="ff-scores"></div></div>
        <div class="ff-log"><h3>Flip log</h3><div id="ff-logrows"></div></div>
      </aside>
      <div class="ff-summary" id="ff-summary" hidden></div>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && st.phase !== 'done' && st.turn === me;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#ff-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'Game over — a draw!' : `${name(st.winner)} wins!`)
        : (st.pending
            ? (st.pending.by === me ? 'Resolve your action card…' : `Waiting for ${name(st.pending.by)} to resolve a card…`)
            : (myTurn() ? 'Your turn — flip or stay.' : `Waiting for ${name(st.turn)}…`));

      $('#ff-deck').setAttribute('data-count', `${st.drawCount ?? 0} left`);

      // reveal the last flipped card
      const rv = $('#ff-reveal');
      const who = $('#ff-revealwho');
      if (st.lastCard) {
        const key = `${st.lastCard.user}|${JSON.stringify(st.lastCard.card)}|${st.round}`;
        rv.innerHTML = cardFace(st.lastCard.card);
        if (key !== lastCardKey && !reduce) {
          const c = rv.querySelector('.ff-card');
          c?.classList.add('ff-flip');
          c?.addEventListener('animationend', () => c.classList.remove('ff-flip'), { once: true });
        }
        lastCardKey = key;
        who.innerHTML = `<b>${name(st.lastCard.user)}</b> flipped`;
      } else {
        rv.innerHTML = '';
        who.textContent = '';
      }

      renderTableaus(name);
      renderPickerOrControls(name);
      renderScoreboard(name);
      renderLog(name);
    }

    function renderTableaus(name) {
      $('#ff-tableaus').innerHTML = st.players.map(u => {
        const line = st.lines[u];
        const sm = STATUS_META[line.status] || STATUS_META.active;
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        const av = sdk.avatarUrl(u);
        const cards = line.cards.map(c => cardFace(c)).join('');
        return `<div class="ff-tab ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}">
          <div class="ff-tab-head">
            <div class="ff-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
            <div class="ff-tab-name">${name(u)}${u === me ? ' (you)' : ''}</div>
            <span class="ff-badge ${sm.cls}">${sm.label}</span>
          </div>
          <div class="ff-tab-cards">${cards || '<span style="font-size:.7rem;color:var(--muted)">No flips yet</span>'}</div>
          <div class="ff-tab-foot">
            <span class="${line.flip7 ? 'ff-uniq f7' : 'ff-uniq'}">${line.numbers.length}/7${line.flip7 ? ' Flip 7!' : ''}</span>
            <span class="ff-score">${st.scores[u] ?? 0}</span>
          </div>
        </div>`;
      }).join('');
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

    function renderScoreboard(name) {
      const SEGMENTS = 14;
      $('#ff-scores').innerHTML = st.players.map(u => {
        const sc = st.scores[u] ?? 0;
        const filled = Math.max(0, Math.min(SEGMENTS, Math.round((sc / st.target) * SEGMENTS)));
        const bar = Array.from({ length: SEGMENTS }, (_, k) => `<span class="ff-seg ${k < filled ? 'on' : ''}"></span>`).join('');
        const av = sdk.avatarUrl(u);
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        return `<div class="ff-player ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}">
          <div class="ff-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
          <div class="ff-pinfo">
            <div class="ff-ptop">
              <span class="ff-pname">${isWin ? '★ ' : ''}${name(u)}${u === me ? ' (you)' : ''}</span>
              <span class="ff-pscore">${sc}</span>
            </div>
            <div class="ff-bar">${bar}</div>
          </div>
        </div>`;
      }).join('') + `<div class="ff-target">First to <b>${st.target}</b></div>`;
    }

    function renderLog(name) {
      $('#ff-logrows').innerHTML = log.length ? log.map((e, i) => {
        const c = cardFace(e.card);
        return `<div class="ff-logrow ${i === 0 ? 'ff-fresh' : ''}">
          <span class="ff-lognm">${name(e.user)}</span>
          <div class="ff-logcard">${c}</div>
          <span class="ff-logtxt">${cardLabel(e.card)}</span>
        </div>`;
      }).join('') : `<div class="ff-empty">No flips yet.</div>`;
    }

    function cardLabel(c) {
      if (c.kind === 'number') return `Number ${c.value}`;
      if (c.kind === 'modifier') return c.mod === 'x2' ? '×2 modifier' : `${c.mod} modifier`;
      return (ACTION_META[c.action] || {}).label || c.action;
    }

    // ---- round-summary overlay ----
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
    let prevRoundSummaryKey = null;
    const apply = s => {
      const prevLast = st?.lastCard;
      st = s;

      // viewer-local flip log (never touches state)
      if (s.lastCard && (!prevLast || prevLast.user !== s.lastCard.user || JSON.stringify(prevLast.card) !== JSON.stringify(s.lastCard.card))) {
        log.unshift({ user: s.lastCard.user, card: s.lastCard.card });
        if (log.length > 40) log.length = 40;
      }

      // round-summary overlay: engine sets roundSummary + increments `round`
      // in the same step (unless the game just ended, where round stays put)
      const rsKey = s.roundSummary ? `${s.round}|${s.winner ?? ''}|${JSON.stringify(s.roundSummary)}` : null;
      if (rsKey && rsKey !== prevRoundSummaryKey) {
        prevRoundSummaryKey = rsKey;
        const finishedRound = s.winner ? s.round : s.round - 1;
        showRoundSummary(s.roundSummary, finishedRound);
        if (s.winner) {
          clearTimeout(summaryTimer);
          summaryTimer = setTimeout(() => showWinScreen(s.winner), 4200);
        }
      }
      render();
    };
    const onStarted     = e => apply(JSON.parse(e.state));
    const onMoved        = e => apply(JSON.parse(e.data));
    const onFinished     = e => apply(JSON.parse(e.state));
    const onRematched    = e => apply(JSON.parse(e.state));
    const onPrivateState = e => apply(JSON.parse(e.data));
    const onError        = e => sdk.toast(e.message);

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
