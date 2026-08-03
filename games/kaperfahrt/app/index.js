/**
 * Kaperfahrt — Game UI.
 *
 * mount(rootEl, sdk) — called only once the match is starting/active. Renders a
 *   felt tabletop (dice / card / controls) on the left and a scoreboard sidebar
 *   on the right. All state is public (dice and cards are open information), so
 *   there is no privateState to handle and no renderSettings — the platform's
 *   generic Start button is used as-is.
 *
 * The tabletop is a deliberately dark "physical" surface with light text; the
 * scoreboard sidebar uses the shell's theme tokens (--text/--surface/--border/
 * --accent*) so it stays readable in both light and dark mode.
 */

const FACE = {
  parrot:  '🦜',
  monkey:  '🐵',
  saber:   '⚔️',
  coin:    '🪙',
  diamond: '💎',
  skull:   '💀',
};
const FACE_KEYS = Object.keys(FACE);

const CARD = {
  sorceress: { emoji: '🧙', title: 'Sorceress', text: 'Once this turn, reroll any dice — even a skull.' },
  captain:   { emoji: '⚓', title: 'Captain',   text: 'Your final score this turn is doubled.' },
  seabattle: { emoji: '🏴‍☠️', title: 'Sea battle' },
  chest:     { emoji: '🧰', title: 'Treasure chest', text: 'Dice you store survive a bust.' },
  coin:      { emoji: '🪙', title: 'Gold coin',  text: 'You start with a 9th die showing a coin.' },
  diamond:   { emoji: '💎', title: 'Diamond',    text: 'You start with a 9th die showing a diamond.' },
  animals:   { emoji: '🐵', title: 'Animals',    text: 'Monkeys and parrots count as the same symbol.' },
  curse:     { emoji: '☠️', title: 'Curse' },
};
function cardMeta(c) {
  if (!c) return { emoji: '', title: '', text: '' };
  const base = CARD[c.type] ?? { emoji: '🃏', title: c.type, text: '' };
  if (c.type === 'seabattle') return { ...base, text: `Get at least ${c.need} sabers for +${c.bonus} — or lose ${c.bonus}.` };
  if (c.type === 'curse') return { ...base, text: `You start the turn with ${c.skulls} skull${c.skulls > 1 ? 's' : ''}.` };
  return base;
}

const STYLE = `
  .kf-root{display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start;font-family:var(--font,inherit)}
  .kf-table{flex:1 1 340px;min-width:300px;position:relative;border-radius:18px;
    padding:1.1rem 1.2rem 1.4rem;color:#f4ecdb;
    background:radial-gradient(ellipse at 50% 22%, #2f8457 0%, #1f5b3c 55%, #163d29 100%);
    border:7px solid #6b4a2b;
    box-shadow:inset 0 0 70px rgba(0,0,0,.5), 0 10px 28px rgba(0,0,0,.35);}
  .kf-table::after{content:"";position:absolute;inset:0;border-radius:12px;pointer-events:none;
    box-shadow:inset 0 0 0 2px rgba(255,255,255,.06);}
  .kf-status{font-weight:700;font-size:1.05rem;margin-bottom:.7rem;text-shadow:0 1px 2px rgba(0,0,0,.5)}
  .kf-card-slot{min-height:1px;margin-bottom:.8rem}
  .kf-card{display:flex;gap:.6rem;align-items:flex-start;max-width:420px;
    background:linear-gradient(160deg,#fff7e6,#f0dfb6);color:#4a3500;
    border:1px solid #d8b877;border-radius:12px;padding:.55rem .8rem;
    box-shadow:0 5px 12px rgba(0,0,0,.3);animation:kf-flip .4s ease;transform-origin:left center}
  .kf-card .kf-cemoji{font-size:1.7rem;line-height:1}
  .kf-card b{display:block;font-size:1.02rem;margin-bottom:.1rem}
  .kf-card small{font-size:.85rem;opacity:.85}
  @keyframes kf-flip{from{transform:perspective(500px) rotateY(85deg);opacity:0}
    to{transform:perspective(500px) rotateY(0);opacity:1}}

  .kf-dice{display:flex;flex-wrap:wrap;gap:.6rem;margin:.4rem 0 .3rem}
  .kf-die{width:62px;height:62px;border-radius:15px;display:flex;align-items:center;justify-content:center;
    font-size:2.05rem;line-height:1;user-select:none;
    background:linear-gradient(150deg,#fffdf7,#e7dfcb);
    box-shadow:0 4px 0 #b9ac8e, 0 7px 12px rgba(0,0,0,.35);
    transition:transform .12s ease, box-shadow .12s ease}
  .kf-die.can{cursor:pointer}
  .kf-die.can:hover{transform:translateY(-3px)}
  .kf-die.sel{transform:translateY(-8px);
    box-shadow:0 8px 0 #b9ac8e,0 12px 16px rgba(0,0,0,.4),0 0 0 3px #ffd24a}
  .kf-die.skull{background:linear-gradient(150deg,#ffe3df,#f4b3aa);box-shadow:0 4px 0 #bf6f5d,0 7px 12px rgba(0,0,0,.35)}
  .kf-die.chest{background:linear-gradient(150deg,#fff0cf,#f2cd77);box-shadow:0 4px 0 #c69a34,0 7px 12px rgba(0,0,0,.35)}
  .kf-die.locked{filter:grayscale(.25);opacity:.9}
  .kf-die.empty{background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 2px rgba(255,255,255,.22);
    color:rgba(255,255,255,.45);font-size:1rem}
  .kf-die.kf-roll{animation:kf-tumble .18s linear infinite}
  .kf-die.kf-settle{animation:kf-pop .32s ease-out}
  @keyframes kf-tumble{0%{transform:rotate(0) translateY(0)}25%{transform:rotate(-20deg) translateY(-9px)}
    50%{transform:rotate(16deg) translateY(2px)}75%{transform:rotate(-9deg) translateY(-5px)}100%{transform:rotate(0)}}
  @keyframes kf-pop{0%{transform:scale(.72)}60%{transform:scale(1.16)}100%{transform:scale(1)}}

  .kf-controls{display:flex;flex-wrap:wrap;gap:.5rem;margin:.7rem 0 .2rem}
  .kf-controls button{font:inherit;font-weight:700;color:#3a2400;border:none;border-radius:999px;
    padding:.5rem 1.05rem;cursor:pointer;transition:transform .1s ease, box-shadow .1s ease;
    background:linear-gradient(150deg,#ffd76a,#f0b429);box-shadow:0 3px 0 #b9821a,0 5px 10px rgba(0,0,0,.3)}
  .kf-controls button:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 5px 0 #b9821a,0 8px 14px rgba(0,0,0,.35)}
  .kf-controls button:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 #b9821a}
  .kf-controls button:disabled{opacity:.5;cursor:not-allowed;box-shadow:0 3px 0 #b9821a}
  .kf-controls button.kf-stop{background:linear-gradient(150deg,#ff9a68,#e8562f);color:#3a1200;box-shadow:0 3px 0 #b23a17,0 5px 10px rgba(0,0,0,.3)}
  .kf-controls button.kf-stop:hover:not(:disabled){box-shadow:0 5px 0 #b23a17,0 8px 14px rgba(0,0,0,.35)}
  .kf-controls button.kf-roll-btn{font-size:1.05rem}
  .kf-last{font-size:.85rem;color:rgba(244,236,219,.8);margin-top:.5rem;min-height:1.1em;text-shadow:0 1px 2px rgba(0,0,0,.4)}

  .kf-side{flex:0 0 224px;min-width:200px}
  .kf-side h3{margin:.1rem 0 .55rem;font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
  .kf-player{display:flex;align-items:center;gap:.55rem;padding:.5rem .6rem;border-radius:14px;margin-bottom:.55rem;
    background:var(--surface);border:1px solid var(--border);color:var(--text);
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
  .kf-player.act{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft);transform:translateX(-3px)}
  .kf-player.win{border-color:var(--success);box-shadow:0 0 0 2px var(--success-soft)}
  .kf-ava{flex:0 0 auto;width:36px;height:36px;border-radius:50%;background:var(--accent-soft) center/cover;
    display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--text);font-size:.9rem}
  .kf-pinfo{flex:1;min-width:0}
  .kf-ptop{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}
  .kf-pname{font-weight:600;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kf-pscore{font-weight:800;font-variant-numeric:tabular-nums;font-size:.92rem}
  .kf-bar{height:6px;border-radius:999px;background:var(--border);overflow:hidden;margin-top:.35rem}
  .kf-bar span{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--success));border-radius:999px;transition:width .5s ease}
  .kf-target{font-size:.72rem;color:var(--muted);margin-top:.1rem}
  .kf-crown{font-size:.85rem}
  .kf-results{margin-top:.6rem;border:2px solid var(--success);border-radius:14px;padding:.7rem;
    background:var(--success-soft);color:var(--text);font-weight:700;text-align:center}

  @media (prefers-reduced-motion: reduce){
    .kf-die.kf-roll,.kf-die.kf-settle,.kf-card{animation:none}
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

    rootEl.innerHTML = `<div class="kf-root"><style>${STYLE}</style>
      <div class="kf-table">
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

    function stopTumbles() { rollTimers.forEach(clearInterval); rollTimers = []; }

    function animateDice(container) {
      stopTumbles();
      if (reduce) { pendingAnim = []; return; }
      for (const i of pendingAnim) {
        const el = container.querySelector(`.kf-die[data-i="${i}"]`);
        if (!el) continue;
        const finalGlyph = el.textContent;
        el.classList.add('kf-roll');
        let n = 0;
        const id = setInterval(() => {
          el.textContent = FACE[FACE_KEYS[(Math.random() * FACE_KEYS.length) | 0]];
          if (++n >= 7) {
            clearInterval(id);
            el.textContent = finalGlyph;
            el.classList.remove('kf-roll');
            el.classList.add('kf-settle');
            setTimeout(() => el.classList.remove('kf-settle'), 320);
          }
        }, 55);
        rollTimers.push(id);
      }
      pendingAnim = [];
    }

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#kf-status').textContent = st.winner
        ? (st.winner === 'draw' ? '🏁 Game over — a draw!' : `🏆 ${name(st.winner)} wins!`)
        : (myTurn()
            ? (st.phase === 'awaitRoll' ? '🫵 Your turn — roll the dice!' : 'Your turn — reroll or bank.')
            : `⏳ Waiting for ${name(st.turn)}…`);

      const cm = cardMeta(st.card);
      $('#kf-card').innerHTML = st.card
        ? `<div class="kf-card"><span class="kf-cemoji">${cm.emoji}</span>
             <span><b>${cm.title}</b><small>${cm.text}</small></span></div>` : '';

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
        return `<div class="${cls.join(' ')}" data-i="${i}">${d.face == null ? '·' : FACE[d.face]}</div>`;
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
        c.innerHTML = `<button id="kf-roll" class="kf-roll-btn">🎲 Roll the dice</button>`;
        $('#kf-roll').addEventListener('click', () => send({ action: 'roll' }));
      } else {
        const sel = [...selected];
        const canSorc = st.card?.type === 'sorceress' && !st.sorceressUsed;
        const canChest = st.card?.type === 'chest';
        c.innerHTML = `
          <button id="kf-reroll" ${sel.length < 2 ? 'disabled' : ''}>🎲 Reroll ${sel.length || ''}</button>
          ${canSorc ? `<button id="kf-sorc" ${sel.length < 1 ? 'disabled' : ''}>🧙 Sorceress</button>` : ''}
          ${canChest ? `<button id="kf-chest" ${sel.length < 1 ? 'disabled' : ''}>🧰 Store</button>` : ''}
          <button id="kf-stop" class="kf-stop">✋ Stop &amp; bank</button>`;
        $('#kf-reroll').addEventListener('click', () => { send({ action: 'reroll', dice: [...selected] }); });
        $('#kf-stop').addEventListener('click', () => send({ action: 'stop' }));
        $('#kf-sorc')?.addEventListener('click', () => { send({ action: 'sorceress', dice: [...selected] }); });
        $('#kf-chest')?.addEventListener('click', () => { send({ action: 'chest', dice: [...selected] }); });
      }

      // last turn
      const lt = st.lastTurn;
      $('#kf-last').textContent = lt
        ? `Last: ${name(lt.user)} — ${cardMeta(lt.card).title} — ${lt.busted ? '💀 busted' : `+${lt.points} pts`}`
        : '';

      // scoreboard
      $('#kf-scores').innerHTML = st.players.map(u => {
        const sc = st.scores[u] ?? 0;
        const pct = Math.max(0, Math.min(100, Math.round((sc / st.target) * 100)));
        const av = sdk.avatarUrl(u);
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        return `<div class="kf-player ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}">
          <div class="kf-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
          <div class="kf-pinfo">
            <div class="kf-ptop">
              <span class="kf-pname">${isWin ? '<span class="kf-crown">👑</span> ' : ''}${name(u)}${u === me ? ' (you)' : ''}</span>
              <span class="kf-pscore">${sc}</span>
            </div>
            <div class="kf-bar"><span style="width:${pct}%"></span></div>
          </div>
        </div>`;
      }).join('') + `<div class="kf-target">First to ${st.target}${st.finalRoundActive ? ' · final round!' : ''}</div>`;

      // results
      $('#kf-results').innerHTML = st.winner
        ? `<div class="kf-results">${st.winner === 'draw' ? '🏁 Draw!' : `🏆 ${name(st.winner)} wins!`}</div>`
        : '';
    }

    // ---- events ----
    const apply = s => {
      const prev = st?.dice;
      // Tumble any die whose face changed as the result of a roll (not on a
      // fresh turn's reset, and not on a store/selection re-render).
      pendingAnim = (s.phase !== 'awaitRoll')
        ? s.dice.map((d, i) => (d.face && (!prev || prev[i]?.face !== d.face)) ? i : -1).filter(i => i >= 0)
        : [];
      st = s;
      selected.clear();
      render();
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
