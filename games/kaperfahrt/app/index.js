/**
 * Kaperfahrt - Game UI (Balatro-style pixel look).
 *
 * mount(rootEl, sdk) - called once the match is starting/active. Left "stage"
 *   holds the dice, controls and a per-card themed background; the right "rail"
 *   stacks a big card showcase, the scoreboard, and a scrollable roll log.
 *
 * The whole panel commits to its OWN fixed dark palette (scoped CSS custom props
 * on `.kf-root`) and ignores the shell's light/dark theme, so contrast and the
 * pixel-art vibe are guaranteed regardless of where it is embedded. Dice faces
 * and card icons are crisp hand-authored pixel sprites (./sprites.js). Text uses
 * a rounded-pixel font ("Pixelify Sans", ./pixelify.ttf) with a bold monospace
 * fallback.
 *
 * All game state is public. Two viewer-local conveniences never touch state:
 *   - sort mode reorders the dice *display* only (tiles keep their original
 *     data-i so moves stay correct);
 *   - keep mode flips what a selection means - reroll the selected dice, or keep
 *     them and reroll the rest - translating to the same `reroll` move.
 */

import { SPRITE } from './sprites.js';

const FACE_KEYS = ['parrot', 'monkey', 'saber', 'coin', 'diamond', 'skull'];

const CARD = {
  sorceress: { icon: 'sorceress', title: 'Sorceress', text: 'Once this turn, reroll any dice - even a skull.' },
  captain:   { icon: 'captain',   title: 'Captain',   text: 'Your final score this turn is doubled.' },
  seabattle: { icon: 'seabattle', title: 'Sea battle' },
  chest:     { icon: 'chest',     title: 'Treasure chest', text: 'Dice you store survive a bust.' },
  coin:      { icon: 'coin',      title: 'Gold coin', text: 'You start with a 9th die showing a coin.' },
  diamond:   { icon: 'diamond',   title: 'Diamond',   text: 'You start with a 9th die showing a diamond.' },
  animals:   { icon: 'animals',   title: 'Animals',   text: 'Monkeys and parrots count as the same symbol.' },
  curse:     { icon: 'curse',     title: 'Curse' },
};
const ACCENT = {
  sorceress: '#8b5cf6', captain: '#3b7dd8', seabattle: '#2fb4be', chest: '#f0b43c',
  coin: '#f5c542', diamond: '#5fd6e8', animals: '#50be78', curse: '#e5484d', island: '#ff5a5a',
};

function cardMeta(c) {
  if (!c) return { icon: '', title: '', text: '' };
  const base = CARD[c.type] ?? { icon: '', title: c.type, text: '' };
  if (c.type === 'seabattle') return { ...base, text: `Get at least ${c.need} sabers for +${c.bonus} - or lose ${c.bonus}.` };
  if (c.type === 'curse') return { ...base, text: `You start the turn with ${c.skulls} skull${c.skulls > 1 ? 's' : ''}.` };
  return base;
}

// The "scene" (showcase + themed background) for the current state.
function scene(st) {
  if (st.phase === 'island') return {
    icon: 'skull', title: 'Island of Skulls', bg: 'kf-bg-island', accent: ACCENT.island, tag: 'stranded',
    text: 'Every skull you roll costs each rival 100 points. Keep rolling until a throw adds no new skull - you score nothing.',
  };
  const cm = cardMeta(st.card);
  const type = st.card?.type;
  return { icon: cm.icon, title: cm.title, text: cm.text, bg: type ? `kf-bg-${type}` : '', accent: ACCENT[type] || '#f5c542', tag: type || '' };
}

const SEGMENTS = 14; // segmented progress bar cells

const STYLE = `
  @font-face{font-family:'Pixelify Sans';src:url('./pixelify.ttf') format('truetype');font-weight:400 700;font-display:swap}

  .kf-root{
    --ink:#14152a; --ink2:#20223f; --panel:#2b2d52; --panel2:#343869;
    --key:#565a9c; --line:#0e0f24; --cream:#f4efe1; --muted:#a6a7d0;
    --blue:#3b7dd8; --blue-d:#22508f; --red:#e5484d; --red-d:#9d2b2f;
    --gold:#f5c542; --gold-d:#b0821a; --green:#3ecf8e; --green-d:#1e8a5b;
    --purple:#8b5cf6; --purple-d:#5a34c0;
    --pix:'Pixelify Sans', ui-monospace, "SFMono-Regular", "Courier New", monospace;
    display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start;
    position:relative; padding:16px; border-radius:18px; color:var(--cream);
    font-family:var(--pix);
    background:radial-gradient(120% 90% at 50% -10%, #2b2d59 0%, #1c1d3c 45%, #121328 100%);
    box-shadow:inset 0 0 0 2px #3a3c73, inset 0 0 90px rgba(0,0,0,.55), 0 12px 30px rgba(0,0,0,.4);
  }

  /* ---- play stage + themed background ---- */
  .kf-stage{position:relative;flex:1 1 360px;min-width:300px;overflow:hidden;
    border-radius:14px;padding:14px 12px 12px;--tint:99,102,180;transition:background .45s ease;
    background:
      radial-gradient(130% 120% at 50% 0%, rgba(var(--tint),.32), rgba(0,0,0,0) 62%),
      radial-gradient(120% 95% at 50% -10%, #23264a 0%, #17182f 48%, #101124 100%);}
  .kf-bg-sorceress{--tint:139,92,246} .kf-bg-captain{--tint:59,125,216}
  .kf-bg-seabattle{--tint:45,180,190} .kf-bg-chest{--tint:240,180,60}
  .kf-bg-coin{--tint:245,197,66} .kf-bg-diamond{--tint:95,214,232}
  .kf-bg-animals{--tint:80,190,120} .kf-bg-curse{--tint:200,70,70}
  .kf-bg-island{--tint:224,52,52}
  .kf-watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    z-index:0;pointer-events:none;opacity:.07}
  .kf-watermark svg{width:74%;height:74%;max-width:360px;image-rendering:pixelated}
  .kf-stage>*:not(.kf-watermark){position:relative;z-index:1}
  .kf-status{font-weight:700;font-size:1.1rem;letter-spacing:.02em;margin:4px 4px 12px;
    text-shadow:2px 2px 0 var(--line)}

  /* ---- dice ---- */
  .kf-dice{display:flex;flex-wrap:wrap;gap:.55rem;margin:.2rem 4px .3rem}
  .kf-die{position:relative;width:60px;height:60px;box-sizing:border-box;
    border:3px solid var(--line);border-radius:3px;padding:5px;background:#e9edfb;
    box-shadow:inset 3px 3px 0 rgba(255,255,255,.9), inset -3px -3px 0 #b3bbdd, 0 6px 0 #8f96bd, 0 9px 0 rgba(0,0,0,.35);
    image-rendering:pixelated;transition:transform .1s ease, box-shadow .1s ease}
  .kf-die .kf-face{display:block;width:100%;height:100%;image-rendering:pixelated}
  .kf-die.can{cursor:pointer}
  .kf-die.can:hover{transform:translateY(-3px)}
  .kf-die.sel{transform:translateY(-11px);
    box-shadow:inset 3px 3px 0 rgba(255,255,255,.9),inset -3px -3px 0 #b3bbdd,0 10px 0 #8f96bd,0 13px 0 rgba(0,0,0,.4),0 0 0 3px var(--gold)}
  .kf-die.kept{box-shadow:inset 3px 3px 0 rgba(255,255,255,.9),inset -3px -3px 0 #b3bbdd,0 6px 0 #8f96bd,0 9px 0 rgba(0,0,0,.35),0 0 0 3px var(--blue)}
  .kf-die.skull{background:#f3cbc7;box-shadow:inset 3px 3px 0 rgba(255,255,255,.75),inset -3px -3px 0 #cf8f8a,0 6px 0 #a5514c,0 9px 0 rgba(0,0,0,.35)}
  .kf-die.chest{background:#ffe6a2;box-shadow:inset 3px 3px 0 rgba(255,255,255,.9),inset -3px -3px 0 #d3ab4e,0 6px 0 #b0871f,0 9px 0 rgba(0,0,0,.35)}
  .kf-die.locked{filter:grayscale(.5) brightness(.85);opacity:.8}
  .kf-die.empty{background:rgba(255,255,255,.06);border-style:dashed;border-color:var(--key);border-radius:3px;box-shadow:none}
  .kf-die.empty::after{content:"";position:absolute;inset:0;margin:auto;width:6px;height:6px;border-radius:2px;background:var(--key)}
  .kf-die.kf-roll{animation:kf-shake .12s steps(2,end) infinite}
  .kf-die.kf-settle{animation:kf-pop .3s ease-out}
  @keyframes kf-shake{0%{transform:translateY(0) scale(1,1)}50%{transform:translateY(-9px) scale(.82,1.18)}100%{transform:translateY(1px) scale(1.1,.9)}}
  @keyframes kf-pop{0%{transform:translateY(2px) scale(.7)}55%{transform:translateY(-2px) scale(1.18)}100%{transform:scale(1)}}

  /* ---- toolbar (viewer-local toggles) ---- */
  .kf-toolbar{display:flex;gap:10px;margin:.85rem 4px .1rem;flex-wrap:wrap}
  .kf-toggle{font-family:var(--pix);font-size:.76rem;font-weight:700;color:var(--cream);
    background:var(--panel2);border:2px solid var(--line);border-radius:8px;padding:.32rem .7rem;cursor:pointer;
    box-shadow:0 3px 0 var(--line);transition:transform .08s ease,box-shadow .08s ease}
  .kf-toggle.on{background:var(--blue);box-shadow:0 3px 0 var(--blue-d)}
  .kf-toggle:active{transform:translateY(3px);box-shadow:0 0 0 var(--line)}

  /* ---- controls ---- */
  .kf-controls{display:flex;flex-wrap:wrap;gap:.6rem;margin:.95rem 4px .4rem}
  .kf-btn{font-family:var(--pix);font-weight:700;font-size:.95rem;letter-spacing:.02em;
    color:var(--cream);border:3px solid var(--line);border-radius:9px;padding:.5rem 1.05rem;
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
    background:radial-gradient(120% 100% at 50% 50%, rgba(229,72,77,.55), rgba(229,72,77,0) 70%);animation:kf-flash .5s ease-out}
  @keyframes kf-flash{0%{opacity:0}25%{opacity:1}100%{opacity:0}}

  /* ---- right rail: showcase / scoreboard / log ---- */
  .kf-rail{flex:0 0 262px;min-width:232px;display:flex;flex-direction:column;gap:12px}
  .kf-showcase{position:relative;border:4px solid var(--line);border-radius:14px;padding:14px 12px 12px;
    text-align:center;--accent:var(--gold);
    background:linear-gradient(180deg,var(--panel2),var(--panel));
    box-shadow:inset 0 0 0 2px var(--key), 5px 5px 0 rgba(0,0,0,.35)}
  .kf-showcase::after{content:"";position:absolute;inset:0;border-radius:10px;pointer-events:none;
    box-shadow:inset 0 0 0 3px color-mix(in srgb, var(--accent) 55%, transparent)}
  .kf-showcase.slam{animation:kf-slam .45s cubic-bezier(.2,1.3,.5,1)}
  @keyframes kf-slam{0%{transform:translateY(-34px) rotate(-6deg);opacity:0}60%{transform:translateY(4px) rotate(2deg);opacity:1}100%{transform:translateY(0) rotate(0)}}
  .kf-sc-icon{width:92px;height:92px;margin:2px auto 10px;padding:9px;image-rendering:pixelated;
    background:var(--ink);border:3px solid var(--line);border-radius:10px}
  .kf-sc-title{font-weight:700;font-size:1.15rem;color:var(--accent);margin-bottom:5px;text-shadow:1px 1px 0 var(--line)}
  .kf-sc-text{font-size:.78rem;color:var(--cream);opacity:.9;line-height:1.3}
  .kf-sc-tag{display:inline-block;margin-top:9px;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--ink);background:var(--accent);border:2px solid var(--line);border-radius:6px;padding:2px 9px;font-weight:700}

  .kf-side{border:3px solid var(--line);border-radius:14px;padding:.7rem;
    background:linear-gradient(180deg,var(--panel),#242648);box-shadow:inset 0 0 0 2px var(--key)}
  .kf-side h3,.kf-log h3{margin:.1rem 0 .6rem;font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);text-align:center}
  .kf-player{display:flex;align-items:center;gap:.55rem;padding:.5rem .55rem;border-radius:10px;margin-bottom:.5rem;
    background:var(--ink2);border:2px solid var(--line);box-shadow:inset 0 0 0 2px rgba(255,255,255,.04);
    transition:transform .15s ease, box-shadow .15s ease, border-color .15s ease}
  .kf-player:last-child{margin-bottom:0}
  .kf-player.act{border-color:var(--blue);box-shadow:0 0 0 2px rgba(59,125,216,.45),inset 0 0 0 2px rgba(255,255,255,.05)}
  .kf-player.win{border-color:var(--green);box-shadow:0 0 0 2px rgba(62,207,142,.5)}
  .kf-player.dock{animation:kf-dock .6s ease}
  @keyframes kf-dock{0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,0)}30%{box-shadow:0 0 0 3px rgba(229,72,77,.8);border-color:var(--red)}}
  .kf-ava{flex:0 0 auto;width:34px;height:34px;border-radius:6px;background:var(--panel2) center/cover;
    border:2px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--cream);font-size:.9rem}
  .kf-pinfo{flex:1;min-width:0}
  .kf-ptop{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}
  .kf-pname{font-weight:700;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .kf-pscore{font-weight:700;font-size:.95rem;color:var(--gold);text-shadow:1px 1px 0 var(--line)}
  .kf-pscore.minus{color:var(--red)}
  .kf-crown{width:14px;height:14px;display:inline-block;vertical-align:-2px;margin-right:2px}
  .kf-bar{display:flex;gap:2px;margin-top:.4rem}
  .kf-seg{flex:1;height:8px;border-radius:1px;background:rgba(255,255,255,.08)}
  .kf-seg.on{background:var(--green);box-shadow:0 0 4px rgba(62,207,142,.6)}
  .kf-target{font-size:.68rem;color:var(--muted);text-align:center;margin-top:.5rem}
  .kf-target b{color:var(--gold)}
  .kf-results{margin-top:.6rem;border:3px solid var(--green);border-radius:10px;padding:.6rem;
    background:rgba(62,207,142,.15);color:var(--cream);font-weight:700;text-align:center}

  .kf-log{border:3px solid var(--line);border-radius:14px;padding:.6rem .5rem;
    background:var(--ink2);box-shadow:inset 0 0 0 2px var(--key);max-height:210px;overflow-y:auto}
  .kf-log .kf-empty{font-size:.72rem;color:var(--muted);text-align:center;padding:.4rem 0}
  .kf-logrow{display:flex;align-items:center;gap:6px;padding:5px 3px;border-bottom:1px solid rgba(255,255,255,.06);font-size:.72rem}
  .kf-logrow:last-child{border-bottom:none}
  .kf-logrow.flash{animation:kf-logflash .8s ease}
  @keyframes kf-logflash{0%{background:rgba(245,197,66,.55)}100%{background:transparent}}
  .kf-lognm{flex:0 0 auto;width:52px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
  .kf-logdice{display:flex;gap:1px;flex:1;min-width:0;overflow:hidden}
  .kf-logdice span{width:14px;height:14px;flex:0 0 auto;image-rendering:pixelated}
  .kf-logres{flex:0 0 auto;font-weight:700;min-width:40px;text-align:right}
  .kf-logres.pos{color:var(--green)} .kf-logres.neg,.kf-logres.isl{color:#ff8a8a} .kf-logres.zero{color:var(--muted)}

  /* ---- saved dice zone (keep mode): a treasure shelf ---- */
  .kf-saved{margin:.9rem 4px .35rem;padding:.7rem .85rem .9rem;border-radius:16px;min-height:96px;
    border:3px solid var(--line);
    background:linear-gradient(180deg,#33291a,#22190f);
    box-shadow:inset 0 0 0 2px rgba(245,197,66,.22), inset 0 7px 18px rgba(0,0,0,.5)}
  .kf-saved[hidden]{display:none}
  .kf-saved .kf-zlabel{display:flex;align-items:center;gap:7px;font-size:.68rem;letter-spacing:.12em;
    text-transform:uppercase;color:var(--gold);margin-bottom:.6rem;text-shadow:1px 1px 0 rgba(0,0,0,.5)}
  .kf-saved .kf-coin{width:16px;height:16px;display:inline-block;image-rendering:pixelated}
  .kf-saved .kf-dice{margin:0;gap:.65rem}
  .kf-saved .kf-die{box-shadow:inset 3px 3px 0 rgba(255,255,255,.9),inset -3px -3px 0 #b3bbdd,0 6px 0 #8f96bd,0 9px 0 rgba(0,0,0,.4),0 0 0 3px var(--gold)}

  /* ---- turn-end summary overlay ---- */
  .kf-summary{position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
    background:rgba(8,9,20,.82);border-radius:18px;cursor:pointer;animation:kf-fadein .2s ease}
  .kf-summary[hidden]{display:none}
  @keyframes kf-fadein{from{opacity:0}to{opacity:1}}
  .kf-card-panel{min-width:250px;max-width:82%;border:4px solid var(--line);border-radius:16px;padding:18px 22px;
    text-align:center;background:linear-gradient(180deg,var(--panel2),var(--panel));
    box-shadow:inset 0 0 0 2px var(--key),0 16px 44px rgba(0,0,0,.55);animation:kf-slam .4s cubic-bezier(.2,1.3,.5,1)}
  .kf-sum-who{font-size:.72rem;color:var(--muted);letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px}
  .kf-sum-card{font-size:1.2rem;font-weight:700;color:var(--accent,#f5c542);margin-bottom:10px;text-shadow:1px 1px 0 var(--line)}
  .kf-sum-dice{display:flex;justify-content:center;flex-wrap:wrap;gap:5px;margin:2px auto 12px;max-width:320px}
  .kf-sum-die{width:30px;height:30px;box-sizing:border-box;padding:3px;image-rendering:pixelated;
    background:#e9edfb;border:2px solid var(--line);border-radius:4px}
  .kf-sum-die.sk{background:#f3cbc7} .kf-sum-die.ch{background:#ffe6a2} .kf-sum-die.lk{filter:grayscale(.5);opacity:.8}
  .kf-sum-lines{display:flex;flex-direction:column;gap:5px;margin:0 auto 10px;max-width:300px}
  .kf-sum-row{display:flex;justify-content:space-between;gap:18px;font-size:.9rem;animation:kf-linein .3s ease backwards}
  .kf-sum-row .lbl{color:var(--cream);opacity:.92}
  .kf-sum-row .val{font-weight:700;color:var(--green)}
  .kf-sum-row .val.mult{color:#b79cf0} .kf-sum-row .val.neg{color:var(--red)}
  @keyframes kf-linein{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
  .kf-sum-total{font-size:2.3rem;font-weight:700;color:var(--gold);text-shadow:3px 3px 0 var(--line);margin-top:4px}
  .kf-sum-total.neg{color:var(--red)}
  .kf-sum-hint{font-size:.64rem;color:var(--muted);margin-top:12px;letter-spacing:.08em}

  @media (prefers-reduced-motion: reduce){
    .kf-die.kf-roll,.kf-die.kf-settle,.kf-showcase,.kf-pop,.kf-stage.busting::before,.kf-player.dock,
    .kf-summary,.kf-card-panel,.kf-sum-row{animation:none}
  }
`;

export default {
  mount(rootEl, sdk) {
    const me = sdk.me.user;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let st = null;                 // full public game state
    let pendingAnim = [];          // die indices to tumble on the next render
    let rollTimers = [];           // active tumble intervals
    const selected = new Set();    // die indices the player has selected
    const shown = {};              // score currently displayed per user (count-up)
    let prevCardKey = null;        // detect a new scene (slam animation)
    let sortMode = false;          // group identical faces in the display
    let keepMode = false;          // selection means "keep" (reroll the rest)
    let summaryTimer = null;        // turn-end overlay auto-dismiss

    rootEl.innerHTML = `<div class="kf-root"><style>${STYLE}</style>
      <div class="kf-stage" id="kf-stage">
        <div class="kf-watermark" id="kf-wm"></div>
        <div class="kf-fx" id="kf-fx"></div>
        <div class="kf-status" id="kf-status">Loading…</div>
        <div class="kf-dice" id="kf-dice"></div>
        <div class="kf-saved" id="kf-savedzone" hidden><span class="kf-zlabel"><span class="kf-coin">${SPRITE.coin}</span>Saved treasure - kept to bank</span><div class="kf-dice" id="kf-saved"></div></div>
        <div class="kf-toolbar" id="kf-toolbar"></div>
        <div class="kf-controls" id="kf-controls"></div>
        <div class="kf-last" id="kf-last"></div>
      </div>
      <aside class="kf-rail">
        <div class="kf-showcase" id="kf-showcase"></div>
        <div class="kf-side"><h3>Scoreboard</h3><div id="kf-scores"></div><div id="kf-results"></div></div>
        <div class="kf-log"><h3>Roll log</h3><div id="kf-logrows"></div></div>
      </aside>
      <div class="kf-summary" id="kf-summary" hidden></div>
    </div>`;
    const $ = id => rootEl.querySelector(id);

    const myTurn = () => st && !st.winner && st.turn === me;
    const send = payload => sdk.send('move', { room: sdk.room.id, data: JSON.stringify(payload) });
    const selectable = d => myTurn() && st.phase === 'rolling' &&
      (d.status === 'active' || (st.card?.type === 'sorceress' && d.status === 'skull'));
    const sprite = face => (face && SPRITE[face]) || '';
    const faceRank = d => (d.face == null ? 99 : FACE_KEYS.indexOf(d.face));
    const activeIndices = () => st.dice.map((d, i) => (d.status === 'active' ? i : -1)).filter(i => i >= 0);

    function stopTumbles() { rollTimers.forEach(clearInterval); rollTimers = []; }

    // FLIP: dice slide from their old position to the new one (e.g. into the
    // Saved shelf) instead of popping. `before` maps data-i → previous rect.
    function flipDice(before) {
      if (reduce || !before.size) return;
      const raised = new Set();
      rootEl.querySelectorAll('.kf-die[data-i]').forEach(el => {
        const b = before.get(el.dataset.i);
        if (!b) return;
        const n = el.getBoundingClientRect();
        const dx = b.left - n.left, dy = b.top - n.top;
        if (!dx && !dy) return;
        // Lift the moving die's zone above its sibling zone so the die slides in
        // FRONT of the treasure shelf (the zones are separate stacking contexts).
        const zone = el.parentElement;
        if (zone && !raised.has(zone)) { zone.style.zIndex = '6'; raised.add(zone); }
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        el.style.zIndex = '3';
        window.requestAnimationFrame(() => {
          el.style.transition = 'transform .32s cubic-bezier(.2,.85,.3,1)';
          el.style.transform = '';
          el.addEventListener('transitionend', () => {
            el.style.transition = ''; el.style.transform = ''; el.style.zIndex = '';
          }, { once: true });
        });
      });
      if (raised.size) setTimeout(() => raised.forEach(z => { z.style.zIndex = ''; }), 380);
    }

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
        if (k < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    }

    function renderScene() {
      const sc = scene(st);
      const stage = $('#kf-stage');
      stage.className = `kf-stage ${sc.bg}`;
      $('#kf-wm').innerHTML = sprite(sc.icon);

      const key = `${st.phase === 'island' ? 'island' : ''}|${st.card ? JSON.stringify(st.card) : ''}`;
      const show = $('#kf-showcase');
      show.style.setProperty('--accent', sc.accent);
      show.innerHTML = `
        <div class="kf-sc-icon">${sprite(sc.icon)}</div>
        <div class="kf-sc-title">${sc.title}</div>
        <div class="kf-sc-text">${sc.text}</div>
        ${sc.tag ? `<span class="kf-sc-tag">${sc.tag}</span>` : ''}`;
      if (key !== prevCardKey && !reduce) { show.classList.remove('slam'); void show.offsetWidth; show.classList.add('slam'); }
      prevCardKey = key;
    }

    function render() {
      if (!st) return;
      const name = u => sdk.nameOf(u);
      renderScene();

      $('#kf-status').textContent = st.winner
        ? (st.winner === 'draw' ? 'Game over - a draw!' : `${name(st.winner)} wins!`)
        : (st.phase === 'island'
            ? (myTurn() ? '☠ Island of Skulls - keep rolling!' : `☠ ${name(st.turn)} is stranded on the island…`)
            : (myTurn()
                ? (st.phase === 'awaitRoll' ? 'Your turn - roll the dice!' : 'Your turn - reroll or bank.')
                : `Waiting for ${name(st.turn)}…`));

      // dice - split into an "in play" zone and, in keep mode, a "saved" zone.
      // data-i stays the original index so moves are correct under sorting.
      const savedZone = $('#kf-savedzone');
      const showSaved = myTurn() && keepMode && st.phase === 'rolling';
      savedZone.hidden = !showSaved;
      const isSaved = i => showSaved && selected.has(i) && st.dice[i].status === 'active';
      const order = sortMode
        ? [...st.dice.keys()].sort((a, b) => faceRank(st.dice[a]) - faceRank(st.dice[b]))
        : [...st.dice.keys()];
      const tile = i => {
        const d = st.dice[i];
        const cls = ['kf-die'];
        if (d.face == null) cls.push('empty');
        if (d.status === 'skull') cls.push('skull');
        else if (d.status === 'chest') cls.push('chest');
        else if (d.status === 'locked') cls.push('locked');
        if (!keepMode && selected.has(i)) cls.push('sel');
        if (selectable(d)) cls.push('can');
        return `<div class="${cls.join(' ')}" data-i="${i}"><span class="kf-face">${sprite(d.face)}</span></div>`;
      };
      const dEl = $('#kf-dice');
      const sEl = $('#kf-saved');
      const beforeRects = new Map();
      rootEl.querySelectorAll('.kf-die[data-i]').forEach(el => beforeRects.set(el.dataset.i, el.getBoundingClientRect()));
      dEl.innerHTML = order.filter(i => !isSaved(i)).map(tile).join('');
      sEl.innerHTML = order.filter(i => isSaved(i)).map(tile).join('');
      [dEl, sEl].forEach(zone => zone.querySelectorAll('.kf-die.can').forEach(el =>
        el.addEventListener('click', () => {
          const i = +el.dataset.i;
          selected.has(i) ? selected.delete(i) : selected.add(i);
          render();
        })));
      flipDice(beforeRects);
      animateDice(dEl);

      // toolbar (sort + keep/reroll) - while it's my active-rolling turn
      const tb = $('#kf-toolbar');
      if (myTurn() && st.phase === 'rolling') {
        tb.innerHTML = `
          <button class="kf-toggle ${sortMode ? 'on' : ''}" id="kf-sort">Sort ${sortMode ? 'on' : 'off'}</button>
          <button class="kf-toggle ${keepMode ? 'on' : ''}" id="kf-mode">Select → ${keepMode ? 'keep' : 'reroll'}</button>`;
        $('#kf-sort').addEventListener('click', () => { sortMode = !sortMode; render(); });
        $('#kf-mode').addEventListener('click', () => { keepMode = !keepMode; selected.clear(); render(); });
      } else tb.innerHTML = '';

      // controls
      const c = $('#kf-controls');
      if (!myTurn()) c.innerHTML = '';
      else if (st.phase === 'island') {
        c.innerHTML = `<button id="kf-iroll" class="kf-btn big stop">Roll again</button>`;
        $('#kf-iroll').addEventListener('click', () => send({ action: 'roll' }));
      } else if (st.phase === 'awaitRoll') {
        c.innerHTML = `<button id="kf-roll" class="kf-btn big">Roll the dice</button>`;
        $('#kf-roll').addEventListener('click', () => send({ action: 'roll' }));
      } else {
        const activeSel = [...selected].filter(i => st.dice[i]?.status === 'active');
        const rerollTargets = keepMode ? activeIndices().filter(i => !selected.has(i)) : activeSel;
        const canReroll = rerollTargets.length >= 2;
        const rerollLabel = keepMode ? `Reroll rest (${rerollTargets.length})` : `Reroll ${activeSel.length || ''}`;
        const canSorc = st.card?.type === 'sorceress' && !st.sorceressUsed;
        const canChest = st.card?.type === 'chest';
        c.innerHTML = `
          <button id="kf-reroll" class="kf-btn" ${canReroll ? '' : 'disabled'}>${rerollLabel}</button>
          ${canSorc ? `<button id="kf-sorc" class="kf-btn sorc" ${selected.size < 1 ? 'disabled' : ''}>Sorceress (${selected.size})</button>` : ''}
          ${canChest ? `<button id="kf-chest" class="kf-btn store" ${activeSel.length < 1 ? 'disabled' : ''}>Store (${activeSel.length})</button>` : ''}
          <button id="kf-stop" class="kf-btn stop">Stop &amp; bank</button>`;
        $('#kf-reroll').addEventListener('click', () => canReroll && send({ action: 'reroll', dice: rerollTargets }));
        $('#kf-stop').addEventListener('click', () => send({ action: 'stop' }));
        $('#kf-sorc')?.addEventListener('click', () => send({ action: 'sorceress', dice: [...selected] }));
        $('#kf-chest')?.addEventListener('click', () => send({ action: 'chest', dice: activeSel }));
      }

      // last-turn line
      const lt = st.lastTurn;
      $('#kf-last').textContent = lt
        ? (lt.island
            ? `Last: ${name(lt.user)} - Island of Skulls - rivals lost ${lt.skulls * 100}`
            : `Last: ${name(lt.user)} - ${cardMeta(lt.card).title} - ${lt.busted ? 'busted' : `+${lt.points} pts`}`)
        : '';

      renderScoreboard(name);
      renderLog(name);
    }

    function renderScoreboard(name) {
      const crown = `<span class="kf-crown">${sprite('coin')}</span>`;
      $('#kf-scores').innerHTML = st.players.map((u, idx) => {
        const sc = st.scores[u] ?? 0;
        const filled = Math.max(0, Math.min(SEGMENTS, Math.round((sc / st.target) * SEGMENTS)));
        const bar = Array.from({ length: SEGMENTS }, (_, k) => `<span class="kf-seg ${k < filled ? 'on' : ''}"></span>`).join('');
        const av = sdk.avatarUrl(u);
        const isTurn = u === st.turn && !st.winner;
        const isWin = st.winner && st.winner !== 'draw' && u === st.winner;
        return `<div class="kf-player ${isTurn ? 'act' : ''} ${isWin ? 'win' : ''}" data-u="${idx}">
          <div class="kf-ava" ${av ? `style="background-image:url('${av}')"` : ''}>${av ? '' : (name(u)[0] || '?').toUpperCase()}</div>
          <div class="kf-pinfo">
            <div class="kf-ptop">
              <span class="kf-pname">${isWin ? crown : ''}${name(u)}${u === me ? ' (you)' : ''}</span>
              <span class="kf-pscore ${sc < 0 ? 'minus' : ''}" data-i="${idx}">${sc}</span>
            </div>
            <div class="kf-bar">${bar}</div>
          </div>
        </div>`;
      }).join('') + `<div class="kf-target">First to <b>${st.target}</b>${st.finalRoundActive ? ' · final round!' : ''}</div>`;

      // count scores toward their new values
      st.players.forEach((u, idx) => {
        const target = st.scores[u] ?? 0;
        const el = $('#kf-scores').querySelector(`.kf-pscore[data-i="${idx}"]`);
        if (!el) return;
        if (shown[u] === undefined) { shown[u] = target; el.textContent = target; return; }
        if (shown[u] !== target) { tweenScore(el, shown[u], target); shown[u] = target; }
        else el.textContent = target;
      });

      $('#kf-results').innerHTML = st.winner
        ? `<div class="kf-results">${st.winner === 'draw' ? 'Draw!' : `${sdk.nameOf(st.winner)} wins!`}</div>`
        : '';
    }

    function renderLog(name) {
      const rows = (st.log || []);
      $('#kf-logrows').innerHTML = rows.length ? rows.map(e => {
        const dice = e.dice.map(d => `<span>${sprite(d.face)}</span>`).join('');
        let res, cls;
        if (e.island) { res = `−${(e.skulls || 0) * 100}`; cls = 'isl'; }
        else if (e.busted) { res = 'BUST'; cls = 'neg'; }
        else if (e.points > 0) { res = `+${e.points}`; cls = 'pos'; }
        else if (e.points < 0) { res = `${e.points}`; cls = 'neg'; }
        else { res = '0'; cls = 'zero'; }
        return `<div class="kf-logrow"><span class="kf-lognm">${name(e.user)}</span>
          <span class="kf-logdice">${dice}</span><span class="kf-logres ${cls}">${res}</span></div>`;
      }).join('') : `<div class="kf-empty">No turns yet.</div>`;
    }

    // ---- turn-end summary overlay ----
    const fmtSigned = v => `${v < 0 ? '-' : (v > 0 ? '+' : '')}${Math.abs(v)}`;
    function hideSummary(toLog) {
      const el = $('#kf-summary');
      if (!el) return;
      clearTimeout(summaryTimer); summaryTimer = null;
      const panel = el.querySelector('.kf-card-panel');
      const log = rootEl.querySelector('.kf-log');
      const done = () => { el.hidden = true; el.innerHTML = ''; el.style.background = ''; el.style.transition = ''; el.onclick = null; };
      if (reduce || !toLog || !panel || !log) { done(); return; }
      // fly the summary panel down into the roll log, then flash the new entry
      const p = panel.getBoundingClientRect(), l = log.getBoundingClientRect();
      const dx = (l.left + l.width / 2) - (p.left + p.width / 2);
      const dy = (l.top + 22) - (p.top + p.height / 2);
      panel.style.transition = 'transform .55s cubic-bezier(.5,0,.75,.4), opacity .55s ease';
      panel.style.transformOrigin = 'center';
      panel.style.transform = `translate(${dx}px, ${dy}px) scale(.1)`;
      panel.style.opacity = '0';
      el.style.transition = 'background .55s ease';
      el.style.background = 'rgba(8,9,20,0)';
      el.onclick = null;
      setTimeout(() => {
        done();
        const first = rootEl.querySelector('.kf-logrow');
        if (first) { first.classList.add('flash'); setTimeout(() => first.classList.remove('flash'), 800); }
      }, 560);
    }
    function showSummary(lt) {
      const el = $('#kf-summary');
      if (!el) return;
      clearTimeout(summaryTimer);
      el.style.background = ''; el.style.transition = '';   // clear any prior fly-out styles
      const accent = lt.island ? ACCENT.island : (ACCENT[lt.card?.type] || '#f5c542');
      const title = lt.island ? 'Island of Skulls' : cardMeta(lt.card).title;
      const total = lt.island ? -(lt.skulls || 0) * 100 : lt.points;
      const head = lt.island ? 'plundered the rivals' : (lt.busted ? 'busted!' : 'banked');
      const rows = (lt.breakdown || []).map((l, i) => {
        const val = l.mult ? `×${l.mult}` : fmtSigned(l.points);
        const cls = l.mult ? 'mult' : (l.points < 0 ? 'neg' : '');
        const suffix = l.perRival ? ' <span style="opacity:.6">/ rival</span>' : '';
        return `<div class="kf-sum-row" style="animation-delay:${(0.12 * i + 0.15).toFixed(2)}s">
          <span class="lbl">${l.label}</span><span class="val ${cls}">${val}${suffix}</span></div>`;
      }).join('') || `<div class="kf-sum-row"><span class="lbl">No score this turn</span><span class="val">0</span></div>`;
      const diceHtml = [...(lt.dice || [])].sort((a, b) => faceRank(a) - faceRank(b)).map(d => {
        const cls = d.status === 'skull' ? ' sk' : (d.status === 'chest' ? ' ch' : (d.status === 'locked' ? ' lk' : ''));
        return `<span class="kf-sum-die${cls}">${sprite(d.face)}</span>`;
      }).join('');
      el.innerHTML = `<div class="kf-card-panel" style="--accent:${accent}">
        <div class="kf-sum-who">${sdk.nameOf(lt.user)} · ${head}</div>
        <div class="kf-sum-card">${title}</div>
        ${diceHtml ? `<div class="kf-sum-dice">${diceHtml}</div>` : ''}
        <div class="kf-sum-lines">${rows}</div>
        <div class="kf-sum-total ${total < 0 ? 'neg' : ''}" id="kf-sum-total">${fmtSigned(total)}</div>
        <div class="kf-sum-hint">tap to continue</div>
      </div>`;
      el.hidden = false;
      el.onclick = () => hideSummary(true);
      if (!reduce) {
        const t = $('#kf-sum-total');
        const start = performance.now(), dur = 700;
        const step = now => {
          const k = Math.min(1, (now - start) / dur);
          t.textContent = fmtSigned(Math.round(total * k));
          if (k < 1) window.requestAnimationFrame(step); else t.textContent = fmtSigned(total);
        };
        window.requestAnimationFrame(step);
      }
      summaryTimer = setTimeout(() => hideSummary(true), 5000);
    }

    // ---- events ----
    const apply = s => {
      const prev = st?.dice;
      const prevLt = st?.lastTurn;
      const prevScores = st?.scores;
      const prevPhase = st?.phase;
      const prevTurn = st?.turn;
      pendingAnim = (s.phase !== 'awaitRoll')
        ? s.dice.map((d, i) => (d.face && (!prev || prev[i]?.face !== d.face)) ? i : -1).filter(i => i >= 0)
        : [];
      st = s;
      // keep-mode selection survives rerolls (the kept dice); else it's transient
      if (!keepMode || s.winner || s.phase === 'awaitRoll' || s.turn !== prevTurn) selected.clear();
      else for (const i of [...selected]) if (s.dice[i]?.status !== 'active') selected.delete(i);
      render();

      // turn-end summary overlay (covers the stage ~3s so everyone sees the math)
      const lt = s.lastTurn;
      const ltChanged = !!lt && (!prevLt || prevLt.user !== lt.user || prevLt.points !== lt.points
        || prevLt.busted !== lt.busted || prevLt.island !== lt.island || prevLt.skulls !== lt.skulls);
      if (ltChanged) showSummary(lt); else hideSummary();

      // island juice (mid-turn): rivals just lost points → red popup + flash rows
      if (prevScores && !ltChanged && (s.phase === 'island' || prevPhase === 'island')) {
        let dock = 0;
        s.players.forEach((u, idx) => {
          const d = (s.scores[u] ?? 0) - (prevScores[u] ?? 0);
          if (u !== s.turn && d < 0) {
            dock = -d;
            const row = $('#kf-scores')?.querySelector(`.kf-player[data-u="${idx}"]`);
            if (row && !reduce) { row.classList.add('dock'); setTimeout(() => row.classList.remove('dock'), 620); }
          }
        });
        if (dock > 0) spawnPopup(`☠ -${dock}`, 'neg');
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
      clearTimeout(summaryTimer);
      sdk.off('started',   onStarted);
      sdk.off('moved',     onMoved);
      sdk.off('finished',  onFinished);
      sdk.off('rematched', onRematched);
      sdk.off('gameError', onError);
    };
  },
};
