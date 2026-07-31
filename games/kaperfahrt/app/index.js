/**
 * Kaperfahrt — Game UI.
 *
 * mount(rootEl, sdk) — called only once the match is starting/active; renders
 *   the active player's dice/card/controls plus a scoreboard. Players + chat
 *   live in the platform's persistent room chrome. All state is public (dice
 *   and cards are open information), so there is no privateState to handle and
 *   no renderSettings — the platform's generic Start button is used as-is.
 */

const FACE = {
  parrot:  '🦜',
  monkey:  '🐵',
  saber:   '⚔️',
  coin:    '🪙',
  diamond: '💎',
  skull:   '💀',
};

function cardText(c) {
  if (!c) return '';
  switch (c.type) {
    case 'sorceress': return 'Sorceress — once this turn, reroll any dice (even a skull).';
    case 'captain':   return 'Captain — your final score this turn is doubled.';
    case 'seabattle': return `Sea battle — get at least ${c.need} sabers for +${c.bonus}, or lose ${c.bonus}.`;
    case 'chest':     return 'Treasure chest — dice you store survive a bust.';
    case 'coin':      return 'Gold coin — you start with a 9th die showing a coin.';
    case 'diamond':   return 'Diamond — you start with a 9th die showing a diamond.';
    case 'animals':   return 'Animals — monkeys and parrots count as the same symbol.';
    case 'curse':     return `Curse — you start the turn with ${c.skulls} skull${c.skulls > 1 ? 's' : ''}.`;
    default:          return c.type;
  }
}
function cardTitle(c) {
  if (!c) return '';
  const names = { sorceress: 'Sorceress', captain: 'Captain', seabattle: 'Sea battle',
    chest: 'Treasure chest', coin: 'Gold coin', diamond: 'Diamond', animals: 'Animals', curse: 'Curse' };
  return names[c.type] ?? c.type;
}

const STYLE = `
  .kf-wrap{font-size:.95rem}
  .kf-status{font-weight:600;margin-bottom:.4rem}
  .kf-card{border:1px solid #c8a24a;background:#fff9ec;color:#3a2d00;border-radius:8px;
           padding:.5rem .7rem;margin:.4rem 0}
  .kf-card b{display:block;font-size:1rem}
  .kf-dice{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0}
  .kf-die{width:56px;height:56px;border-radius:10px;border:2px solid #bbb;background:#fff;
          display:flex;align-items:center;justify-content:center;font-size:1.9rem;line-height:1;
          user-select:none}
  .kf-die.empty{color:#bbb;font-size:1rem;border-style:dashed}
  .kf-die.sel{border-color:#2266cc;box-shadow:0 0 0 3px #2266cc55}
  .kf-die.skull{border-color:#c0392b;background:#fdecea}
  .kf-die.chest{border-color:#c8a24a;background:#fff3d6}
  .kf-die.locked{border-color:#888;background:#f2f2f2}
  .kf-die.can{cursor:pointer}
  .kf-die.can:hover{filter:brightness(1.05)}
  .kf-controls{display:flex;flex-wrap:wrap;gap:.5rem;margin:.5rem 0}
  .kf-controls button{padding:.4rem .8rem;border-radius:6px;border:1px solid #888;cursor:pointer}
  .kf-controls button:disabled{opacity:.45;cursor:not-allowed}
  .kf-scores{width:100%;border-collapse:collapse;margin-top:.6rem;font-size:.9rem}
  .kf-scores th,.kf-scores td{padding:.25rem .5rem;border:1px solid #ddd;text-align:left}
  .kf-scores tr.turn td{background:#eef6ff;font-weight:600}
  .kf-last{font-size:.85rem;color:#555;margin-top:.4rem}
  .kf-results{margin-top:.8rem;border:2px solid #2a7;border-radius:8px;padding:.7rem;background:#f4fff9}
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    let st = null;                 // full public game state
    const selected = new Set();    // die indices the player has selected

    rootEl.innerHTML = `<div class="kf-wrap"><style>${STYLE}</style>
      <div class="kf-status" id="kf-status">Loading…</div>
      <div id="kf-card"></div>
      <div class="kf-dice" id="kf-dice"></div>
      <div class="kf-controls" id="kf-controls"></div>
      <div class="kf-last" id="kf-last"></div>
      <table class="kf-scores" id="kf-scores"></table>
      <div id="kf-results"></div>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && !st.winner && st.turn === me;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });
    const selectable = d => myTurn() && st.phase !== 'awaitRoll' &&
      (d.status === 'active' || (st.card?.type === 'sorceress' && d.status === 'skull'));

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);

      $('#kf-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'Game over — a draw!' : `Game over — ${name(st.winner)} wins!`)
        : (myTurn()
            ? (st.phase === 'awaitRoll' ? 'Your turn — roll the dice!' : 'Your turn — reroll or stop.')
            : `Waiting for ${name(st.turn)}…`);

      $('#kf-card').innerHTML = st.card
        ? `<div class="kf-card"><b>${cardTitle(st.card)}</b>${cardText(st.card)}</div>` : '';

      // dice
      $('#kf-dice').innerHTML = st.dice.map((d, i) => {
        const cls = ['kf-die'];
        if (d.face == null) cls.push('empty');
        if (d.status === 'skull') cls.push('skull');
        else if (d.status === 'chest') cls.push('chest');
        else if (d.status === 'locked') cls.push('locked');
        if (selected.has(i)) cls.push('sel');
        if (selectable(d)) cls.push('can');
        const glyph = d.face == null ? '·' : FACE[d.face];
        return `<div class="${cls.join(' ')}" data-i="${i}">${glyph}</div>`;
      }).join('');
      $('#kf-dice').querySelectorAll('.kf-die.can').forEach(el =>
        el.addEventListener('click', () => {
          const i = +el.dataset.i;
          selected.has(i) ? selected.delete(i) : selected.add(i);
          render();
        }));

      // controls
      const c = $('#kf-controls');
      if (!myTurn()) { c.innerHTML = ''; }
      else if (st.phase === 'awaitRoll') {
        c.innerHTML = `<button id="kf-roll">🎲 Roll all dice</button>`;
        $('#kf-roll').addEventListener('click', () => send({ action: 'roll' }));
      } else {
        const sel = [...selected];
        const canSorc = st.card?.type === 'sorceress' && !st.sorceressUsed;
        const canChest = st.card?.type === 'chest';
        c.innerHTML = `
          <button id="kf-reroll" ${sel.length < 2 ? 'disabled' : ''}>Reroll ${sel.length} selected</button>
          ${canSorc ? `<button id="kf-sorc" ${sel.length < 1 ? 'disabled' : ''}>🧙 Sorceress reroll</button>` : ''}
          ${canChest ? `<button id="kf-chest" ${sel.length < 1 ? 'disabled' : ''}>🧰 Store in chest</button>` : ''}
          <button id="kf-stop">✋ Stop &amp; bank</button>`;
        $('#kf-reroll').addEventListener('click', () => { send({ action: 'reroll', dice: [...selected] }); selected.clear(); });
        $('#kf-stop').addEventListener('click', () => send({ action: 'stop' }));
        $('#kf-sorc')?.addEventListener('click', () => { send({ action: 'sorceress', dice: [...selected] }); selected.clear(); });
        $('#kf-chest')?.addEventListener('click', () => { send({ action: 'chest', dice: [...selected] }); selected.clear(); });
      }

      // last turn
      const lt = st.lastTurn;
      $('#kf-last').textContent = lt
        ? `Last: ${name(lt.user)} — ${cardTitle(lt.card)} — ${lt.busted ? '💀 busted' : `${lt.points} pts`}`
        : '';

      // scoreboard
      $('#kf-scores').innerHTML = `
        <tr><th>Player</th><th>Score</th></tr>
        ${st.players.map(u => `<tr class="${u === st.turn && !st.winner ? 'turn' : ''}">
          <td>${name(u)}${u === me ? ' (you)' : ''}</td><td>${st.scores[u] ?? 0}</td></tr>`).join('')}
        <tr><td colspan="2">Target: ${st.target}${st.finalRoundActive ? ' — final round!' : ''}</td></tr>`;

      // results
      $('#kf-results').innerHTML = st.winner
        ? `<div class="kf-results"><b>${st.winner === 'draw' ? 'Draw!' : `${name(st.winner)} wins!`}</b></div>`
        : '';
    }

    // ---- events ----
    const apply = s => { st = s; selected.clear(); render(); };
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
      sdk.off('started',   onStarted);
      sdk.off('moved',     onMoved);
      sdk.off('finished',  onFinished);
      sdk.off('rematched', onRematched);
      sdk.off('gameError', onError);
    };
  },
};
