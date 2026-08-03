/**
 * Kaperfahrt — Game UI (Balatro-style pixel look).
 *
 * mount(rootEl, sdk) — called once the match is starting/active. Renders a dark,
 *   saturated pixel-art "stage" (dice / card / controls) on the left and a
 *   scoreboard sidebar on the right. All state is public (dice and cards are open
 *   information), so there is no privateState to handle and no renderSettings —
 *   the platform's generic Start button is used as-is.
 *
 * The whole panel commits to its OWN fixed dark palette (scoped CSS custom props
 * on `.kf-root`) and ignores the shell's light/dark theme, so contrast and the
 * pixel-art vibe are guaranteed regardless of where it is embedded. Dice faces
 * and card icons are crisp hand-authored pixel sprites (./sprites.js). Text uses
 * a rounded-pixel font ("Pixelify Sans") when ./pixelify.woff2 is present, and
 * falls back to a bold monospace otherwise.
 */

import { SPRITE } from './sprites.js';

const FACE_KEYS = ['parrot', 'monkey', 'saber', 'coin', 'diamond', 'skull'];

const CARD = {
  sorceress: { icon: 'sorceress', title: 'Sorceress', text: 'Once this turn, reroll any dice — even a skull.' },
  captain:   { icon: 'captain',   title: 'Captain',   text: 'Your final score this turn is doubled.' },
  seabattle: { icon: 'seabattle', title: 'Sea battle' },
  chest:     { icon: 'chest',     title: 'Treasure chest', text: 'Dice you store survive a bust.' },
  coin:      { icon: 'coin',      title: 'Gold coin', text: 'You start with a 9th die showing a coin.' },
  diamond:   { icon: 'diamond',   title: 'Diamond',   text: 'You start with a 9th die showing a diamond.' },
  animals:   { icon: 'animals',   title: 'Animals',   text: 'Monkeys and parrots count as the same symbol.' },
  curse:     { icon: 'curse',     title: 'Curse' },
};
function cardMeta(c) {
  if (!c) return { icon: '', title: '', text: '' };
  const base = CARD[c.type] ?? { icon: '', title: c.type, text: '' };
  if (c.type === 'seabattle') return { ...base, text: `Get at least ${c.need} sabers for +${c.bonus} — or lose ${c.bonus}.` };
  if (c.type === 'curse') return { ...base, text: `You start the turn with ${c.skulls} skull${c.skulls > 1 ? 's' : ''}.` };
  return base;
}

const SEGMENTS = 14; // segmented progress bar cells

const STYLE = `
  @font-face{font-family:'Pixelify Sans';src:url('./pixelify.woff2') format('woff2');font-weight:400 700;font-display:swap}

  .kf-root{
    --ink:#14152a; --ink2:#20223f; --panel:#2b2d52; --panel2:#343869;
    --key:#565a9c; --line:#0e0f24; --cream:#f4efe1; --muted:#a6a7d0;
    --blue:#3b7dd8; --blue-d:#22508f; --red:#e5484d; --red-d:#9d2b2f;
    --gold:#f5c542; --gold-d:#b0821a; --green:#3ecf8e; --green-d:#1e8a5b;
    --purple:#8b5cf6; --purple-d:#5a34c0;
    --pix:'Pixelify Sans', ui-monospace, "SFMono-Regular", "Courier New", monospace;
    display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;
    padding:16px; border-radius:18px; color:var(--cream);
    font-family:var(--pix);
    background:
      radial-gradient(120% 90% at 50% -10%, #2b2d59 0%, #1c1d3c 45%, #121328 100%);
    box-shadow:inset 0 0 0 2px #3a3c73, inset 0 0 90px rgba(0,0,0,.55), 0 12px 30px rgba(0,0,0,.4);
  }

  /* ---- play stage ---- */
  .kf-stage{position:relative;flex:1 1 360px;min-width:300px;
    background:radial-gradient(130% 120% at 50% 0%, rgba(60,64,120,.35), rgba(0,0,0,0) 60%);
    border-radius:14px;padding:6px 4px 2px;overflow:hidden}
  .kf-status{font-weight:700;font-size:1.1rem;letter-spacing:.02em;margin:4px 4px 12px;
    text-shadow:2px 2px 0 var(--line)}

  .kf-card-slot{min-height:1px;margin:0 4px 14px}
  .kf-card{display:flex;gap:.7rem;align-items:center;max-width:440px;
    background:linear-gradient(180deg,var(--panel2),var(--panel));
    border:3px solid var(--line);border-radius:12px;padding:.55rem .7rem;
    box-shadow:inset 0 0 0 2px var(--key), 4px 4px 0 rgba(0,0,0,.35);
    transform:rotate(-2deg);transform-origin:center;animation:kf-slam .45s cubic-bezier(.2,1.3,.5,1)}
  .kf-cardicon{flex:0 0 auto;width:46px;height:46px;padding:3px;image-rendering:pixelated;
    background:var(--ink);border:2px solid var(--line);border-radius:8px}
  .kf-card b{display:block;font-size:1.05rem;line-height:1.1;margin-bottom:.15rem;color:var(--gold)}
  .kf-card small{font-size:.8rem;line-height:1.15;color:var(--cream);opacity:.9}
  @keyframes kf-slam{0%{transform:translateY(-42px) rotate(-9deg);opacity:0}
    60%{transform:translateY(4px) rotate(2deg);opacity:1}100%{transform:translateY(0) rotate(-2deg)}}

  /* ---- dice ---- */
  .kf-dice{display:flex;flex-wrap:wrap;gap:.55rem;margin:.2rem 4px .3rem}
  .kf-die{position:relative;width:58px;height:58px;box-sizing:border-box;
    border:3px solid var(--line);border-radius:11px;padding:6px;
    background:linear-gradient(180deg,#ecf0fb,#c3c9e6);
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.5), 0 5px 0 #8f96bd, 0 8px 12px rgba(0,0,0,.4);
    transition:transform .1s ease, box-shadow .1s ease}
  .kf-die .kf-face{display:block;width:100%;height:100%;image-rendering:pixelated}
  .kf-die.can{cursor:pointer}
  .kf-die.can:hover{transform:translateY(-3px)}
  .kf-die.sel{transform:translateY(-11px);
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.5),0 9px 0 #8f96bd,0 14px 16px rgba(0,0,0,.45),0 0 0 3px var(--gold)}
  .kf-die.skull{background:linear-gradient(180deg,#f6cfcb,#d98a86);box-shadow:inset 0 0 0 2px rgba(255,255,255,.4),0 5px 0 #a5514c,0 8px 12px rgba(0,0,0,.4)}
  .kf-die.chest{background:linear-gradient(180deg,#ffe7a6,#e6bd54);box-shadow:inset 0 0 0 2px rgba(255,255,255,.5),0 5px 0 #b0871f,0 8px 12px rgba(0,0,0,.4)}
  .kf-die.locked{filter:grayscale(.5) brightness(.85);opacity:.8}
  .kf-die.empty{background:rgba(255,255,255,.06);border-style:dashed;border-color:var(--key);
    box-shadow:none}
  .kf-die.empty::after{content:"";position:absolute;inset:0;margin:auto;width:6px;height:6px;
    border-radius:2px;background:var(--key)}
  .kf-die.kf-roll{animation:kf-shake .12s steps(2,end) infinite}
  .kf-die.kf-settle{animation:kf-pop .3s ease-out}
  @keyframes kf-shake{0%{transform:translateY(0) scale(1,1)}
    50%{transform:translateY(-9px) scale(.82,1.18)}100%{transform:translateY(1px) scale(1.1,.9)}}
  @keyframes kf-pop{0%{transform:translateY(2px) scale(.7)}55%{transform:translateY(-2px) scale(1.18)}100%{transform:scale(1)}}

  /* ---- controls ---- */
  .kf-controls{display:flex;flex-wrap:wrap;gap:.5rem;margin:.85rem 4px .3rem}
  .kf-btn{font-family:var(--pix);font-weight:700;font-size:.95rem;letter-spacing:.02em;
    color:var(--cream);border:3px solid var(--line);border-radius:9px;padding:.45rem .9rem;
    cursor:pointer;background:var(--blue);
    box-shadow:inset 0 2px 0 rgba(255,255,255,.25), 0 4px 0 var(--blue-d);
    transition:transform .08s ease, box-shadow .08s ease}
  .kf-btn:hover:not(:disabled){filter:brightness(1.08)}
  .kf-btn:active:not(:disabled){transform:translateY(4px);box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--blue-d)}
  .kf-btn:disabled{opacity:.45;cursor:not-allowed}
  .kf-btn.big{font-size:1.05rem;padding:.55rem 1.1rem}
  .kf-btn.stop{background:var(--red);box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 4px 0 var(--red-d)}
  .kf-btn.stop:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--red-d)}
  .kf-btn.sorc{background:var(--purple);box-shadow:inset 0 2px 0 rgba(255,255,255,.25),0 4px 0 var(--purple-d)}
  .kf-btn.sorc:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.2),0 0 0 var(--purple-d)}
  .kf-btn.store{background:var(--gold);color:#3a2a00;box-shadow:inset 0 2px 0 rgba(255,255,255,.4),0 4px 0 var(--gold-d)}
  .kf-btn.store:active:not(:disabled){box-shadow:inset 0 2px 0 rgba(255,255,255,.3),0 0 0 var(--gold-d)}
  .kf-last{font-size:.8rem;color:var(--muted);margin:.6rem 4px .2rem;min-height:1.1em}

  /* ---- floating score juice ---- */
  .kf-fx{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5}
  .kf-pop{position:absolute;left:50%;top:44%;transform:translate(-50%,0);
    font-family:var(--pix);font-weight:700;font-size:2.1rem;color:var(--gold);
    text-shadow:3px 3px 0 var(--line);white-space:nowrap;animation:kf-rise 1.2s ease-out forwards}
  .kf-pop.neg,.kf-pop.bust{color:var(--red)}
  @keyframes kf-rise{0%{opacity:0;transform:translate(-50%,14px) scale(.5)}
    22%{opacity:1;transform:translate(-50%,-6px) scale(1.2)}100%{opacity:0;transform:translate(-50%,-64px) scale(1)}}
  .kf-stage.busting::before{content:"";position:absolute;inset:0;z-index:4;pointer-events:none;
    background:radial-gradient(120% 100% at 50% 50%, rgba(229,72,77,.55), rgba(229,72,77,0) 70%);
    animation:kf-flash .5s ease-out}
  @keyframes kf-flash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}

  /* ---- scoreboard ---- */
  .kf-side{flex:0 0 240px;min-width:210px;
    background:linear-gradient(180deg,var(--panel),#242648);
    border:3px solid var(--line);border-radius:14px;padding:.7rem;
    box-shadow:inset 0 0 0 2px var(--key)}
  .kf-side h3{margin:.1rem 0 .7rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;
    color:var(--muted);text-align:center}
  .kf-player{display:flex;align-items:center;gap:.55rem;padding:.5rem .55rem;border-radius:10px;
    margin-bottom:.5rem;background:var(--ink2);border:2px solid var(--line);
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.04);
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
  .kf-player.act{border-color:var(--blue);box-shadow:0 0 0 2px rgba(59,125,216,.45),inset 0 0 0 2px rgba(255,255,255,.05)}
  .kf-player.win{border-color:var(--green);box-shadow:0 0 0 2px rgba(62,207,142,.5)}
  .kf-ava{flex:0 0 auto;width:34px;height:34px;border-radius:6px;background:var(--panel2) center/cover;
    border:2px solid var(--line);display:flex;align-items:center;justify-content:center;
    font-weight:700;color:var(--cream);font-size:.9rem}
  .kf-pinfo{flex:1;min-width:0}
  .kf-ptop{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}
  .kf-pname{font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kf-pscore{font-weight:700;font-size:.95rem;color:var(--gold);text-shadow:1px 1px 0 var(--line)}
  .kf-crown{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:2px}
  .kf-bar{display:flex;gap:2px;margin-top:.4rem}
  .kf-seg{flex:1;height:8px;border-radius:1px;background:rgba(255,255,255,.08)}
  .kf-seg.on{background:var(--green);box-shadow:0 0 4px rgba(62,207,142,.6)}
  .kf-target{font-size:.68rem;color:var(--muted);text-align:center;margin-top:.5rem}
  .kf-target b{color:var(--gold)}
  .kf-results{margin-top:.6rem;border:3px solid var(--green);border-radius:10px;padding:.6rem;
    background:rgba(62,207,142,.15);color:var(--cream);font-weight:700;text-align:center}

  @media (prefers-reduced-motion: reduce){
    .kf-die.kf-roll,.kf-die.kf-settle,.kf-card,.kf-pop,.kf-stage.busting::before{animation:none}
  }
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    const reduce = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let st = null;                 // full public game state
    let pendingAnim = [];          // die indices to tumble on the next render
    let rollTimers = [];           // active tumble intervals
    const selected = new Set();    // die indices the player has selected
    const shown = {};              // score currently displayed per user (for count-up)
    let prevCardKey = null;        // to detect a new drawn card (slam animation)

    rootEl.innerHTML = `<div class="kf-root"><style>${STYLE}</style>
      <div class="kf-stage" id="kf-stage">
        <div class="kf-fx" id="kf-fx"></div>
        <div class="kf-status" id="kf-status">Loading…</div>
        <div class="kf-card-slot" id="kf-card"></div>
        <div class="kf-dice" id="kf-dice"></div>
        <div class="kf-controls" id="kf-controls"></div>
        <div class="kf-last" id="kf-last"></div>
      </div>
      <aside class="kf-side">
        <h3>Scoreboard</h3>
        <div id="kf-scores"></div>
        <div id="kf-results"></div>
      </aside>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && !st.winner && st.turn === me;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });
    const selectable = d => myTurn() && st.phase !== 'awaitRoll' &&
      (d.status === 'active' || (st.card?.type === 'sorceress' && d.status === 'skull'));
    const sprite = face => (face && SPRITE[face]) || '';

    function stopTumbles() { rollTimers.forEach(clearInterval); rollTimers = []; }

    // Dice roll: hard-stepped sprite cycling + a squash/stretch bounce, settling
    // on a pop. Only dice flagged in pendingAnim (their face changed) animate.
    function animateDice(container) {
      stopTumbles();
      if (reduce) { pendingAnim = []; return; }
      for (const i of pendingAnim) {
        const el = container.querySelector(`.kf-die[data-i="${i}"] .kf-face`);
        const tile = container.querySelector(`.kf-die[data-i="${i}"]`);
        if (!el || !tile) continue;
        const finalSvg = el.innerHTML;
        tile.classList.add('kf-roll');
        let n = 0;
        const id = setInterval(() => {
          el.innerHTML = sprite(FACE_KEYS[(Math.random() * FACE_KEYS.length) | 0]);
          if (++n >= 7) {
            clearInterval(id);
            el.innerHTML = finalSvg;
            tile.classList.remove('kf-roll');
            tile.classList.add('kf-settle');
            setTimeout(() => tile.classList.remove('kf-settle'), 300);
          }
        }, 55);
        rollTimers.push(id);
      }
      pendingAnim = [];
    }

    function spawnPopup(text, kind) {
      if (reduce) return;
      const fx = $('#kf-fx');
      if (!fx) return;
      const el = document.createElement('div');
      el.className = `kf-pop ${kind || ''}`;
      el.textContent = text;
      fx.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }

    function tweenScore(el, from, to) {
      if (reduce || from === to) { el.textContent = to; return; }
      const start = performance.now(), dur = 550;
      const step = t => {
        const k = Math.min(1, (t - start) / dur);
        el.textContent = Math.round(from + (to - from) * k);
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#kf-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'Game over — a draw!' : `${name(st.winner)} wins!`)
        : (myTurn()
            ? (st.phase === 'awaitRoll' ? 'Your turn — roll the dice!' : 'Your turn — reroll or bank.')
            : `Waiting for ${name(st.turn)}…`);

      // card (slam only when a new card is drawn)
      const cm = cardMeta(st.card);
      const cardKey = st.card ? JSON.stringify(st.card) : null;
      const slot = $('#kf-card');
      if (!st.card) { slot.innerHTML = ''; }
      else {
        slot.innerHTML = `<div class="kf-card"><div class="kf-cardicon">${sprite(cm.icon)}</div>
          <div><b>${cm.title}</b><small>${cm.text}</small></div></div>`;
        if (cardKey === prevCardKey) slot.firstElementChild.style.animation = 'none';
      }
      prevCardKey = cardKey;

      // dice
      const dEl = $('#kf-dice');
      dEl.innerHTML = st.dice.map((d, i) => {
        const cls = ['kf-die'];
        if (d.face == null) cls.push('empty');
        if (d.status === 'skull') cls.push('skull');
        else if (d.status === 'chest') cls.push('chest');
        else if (d.status === 'locked') cls.push('locked');
        if (selected.has(i)) cls.push('sel');
        if (selectable(d)) cls.push('can');
        return `<div class="${cls.join(' ')}" data-i="${i}"><span class="kf-face">${sprite(d.face)}</span></div>`;
      }).join('');
      dEl.querySelectorAll('.kf-die.can').forEach(el =>
        el.addEventListener('click', () => {
          const i = +el.dataset.i;
          selected.has(i) ? selected.delete(i) : selected.add(i);
          render();
        }));
      animateDice(dEl);

      // controls
      const c = $('#kf-controls');
      if (!myTurn()) { c.innerHTML = ''; }
      else if (st.phase === 'awaitRoll') {
        c.innerHTML = `<button id="kf-roll" class="kf-btn big">Roll the dice</button>`;
        $('#kf-roll').addEventListener('click', () => send({ action: 'roll' }));
      } else {
        const sel = [...selected];
        const canSorc = st.card?.type === 'sorceress' && !st.sorceressUsed;
        const canChest = st.card?.type === 'chest';
        c.innerHTML = `
          <button id="kf-reroll" class="kf-btn" ${sel.length < 2 ? 'disabled' : ''}>Reroll ${sel.length || ''}</button>
          ${canSorc ? `<button id="kf-sorc" class="kf-btn sorc" ${sel.length < 1 ? 'disabled' : ''}>Sorceress</button>` : ''}
          ${canChest ? `<button id="kf-chest" class="kf-btn store" ${sel.length < 1 ? 'disabled' : ''}>Store</button>` : ''}
          <button id="kf-stop" class="kf-btn stop">Stop &amp; bank</button>`;
        $('#kf-reroll').addEventListener('click', () => send({ action: 'reroll', dice: [...selected] }));
        $('#kf-stop').addEventListener('click', () => send({ action: 'stop' }));
        $('#kf-sorc')?.addEventListener('click', () => send({ action: 'sorceress', dice: [...selected] }));
        $('#kf-chest')?.addEventListener('click', () => send({ action: 'chest', dice: [...selected] }));
      }

      // last turn line
      const lt = st.lastTurn;
      $('#kf-last').textContent = lt
        ? `Last: ${name(lt.user)} — ${cardMeta(lt.card).title} — ${lt.busted ? 'busted' : `+${lt.points} pts`}`
        : '';

      // scoreboard
      const crown = `<span class="kf-crown">${sprite('coin')}</span>`;
      $('#kf-scores').innerHTML = st.players.map((u, idx) => {
        const sc = st.scores[u] ?? 0;
        const filled = Math.max(0, Math.min(SEGMENTS, Math.round((sc / st.target) * SEGMENTS)));
        const bar = Array.from({ length: SEGMENTS },
          (_, k) => `<span class="kf-seg ${k < filled ? 'on' : ''}"></span>`).join('');
        const av = sdk.avatarUrl(u);
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        return `<div class="kf-player ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}">
          <div class="kf-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
          <div class="kf-pinfo">
            <div class="kf-ptop">
              <span class="kf-pname">${isWin ? crown : ''}${name(u)}${u === me ? ' (you)' : ''}</span>
              <span class="kf-pscore" data-i="${idx}">${sc}</span>
            </div>
            <div class="kf-bar">${bar}</div>
          </div>
        </div>`;
      }).join('') + `<div class="kf-target">First to <b>${st.target}</b>${st.finalRoundActive ? ' · final round!' : ''}</div>`;

      // count scores up to their new values
      st.players.forEach((u, idx) => {
        const target = st.scores[u] ?? 0;
        const el = $('#kf-scores').querySelector(`.kf-pscore[data-i="${idx}"]`);
        if (!el) return;
        if (shown[u] === undefined) { shown[u] = target; el.textContent = target; return; }
        if (shown[u] !== target) { tweenScore(el, shown[u], target); shown[u] = target; }
        else { el.textContent = target; }
      });

      // results banner
      $('#kf-results').innerHTML = st.winner
        ? `<div class="kf-results">${st.winner === 'draw' ? 'Draw!' : `${name(st.winner)} wins!`}</div>`
        : '';
    }

    // ---- events ----
    const apply = s => {
      const prev = st?.dice;
      const prevLt = st?.lastTurn;
      // Tumble any die whose face changed as the result of a roll (not on a
      // fresh turn's reset, and not on a store/selection re-render).
      pendingAnim = (s.phase !== 'awaitRoll')
        ? s.dice.map((d, i) => (d.face && (!prev || prev[i]?.face !== d.face)) ? i : -1).filter(i => i >= 0)
        : [];
      st = s;
      selected.clear();
      render();

      // score juice: a freshly banked turn spawns a floating +N / −N / BUST pop
      const lt = s.lastTurn;
      const isNew = lt && (!prevLt || prevLt.user !== lt.user || prevLt.points !== lt.points || prevLt.busted !== lt.busted);
      if (isNew) {
        const stage = $('#kf-stage');
        if (lt.busted) {
          spawnPopup('BUST 💀', 'bust');
          if (!reduce && stage) { stage.classList.add('busting'); setTimeout(() => stage.classList.remove('busting'), 520); }
        } else if (lt.points < 0) {
          spawnPopup(`${lt.points}`, 'neg');
        } else if (lt.points > 0) {
          spawnPopup(`+${lt.points}`);
        }
      }
    };
    const onStarted   = e => apply(JSON.parse(e.state));
    const onMoved     = e => apply(JSON.parse(e.data));
    const onFinished  = e => apply(JSON.parse(e.state));
    const onRematched = e => apply(JSON.parse(e.state));
    const onError     = e => sdk.toast(e.message);

    sdk.on('started',   onStarted);
    sdk.on('moved',     onMoved);
    sdk.on('finished',  onFinished);
    sdk.on('rematched', onRematched);
    sdk.on('gameError', onError);

    return () => {
      stopTumbles();
      sdk.off('started',   onStarted);
      sdk.off('moved',     onMoved);
      sdk.off('finished',  onFinished);
      sdk.off('rematched', onRematched);
      sdk.off('gameError', onError);
    };
  },
};
