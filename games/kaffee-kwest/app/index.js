/**
 * Kaffee-Kwest UI — mount(rootEl, sdk)
 *
 * Three screens inside the game area:
 *   lobby  — scenario pick (host), archetype + own chronicle (everyone)
 *   story  — narrative log, progress, one mechanic panel (vote / roll / moment)
 *   finale — reached ending, chronicle suggestions with player veto
 *
 * The host UI drives the prepare flow (Kaiten pattern):
 *   KaffeeKwestService.prepare() -> configure(settings) -> start
 * Note: the platform's generic host "Start game" button is NOT used — starting
 * without prepare would fail, so this game renders its own start control.
 */
import { mountChat }    from '/shell/chat.js';
import { mountPlayers } from '/shell/players.js';

const CSS = `
.kk-layout { display:flex; gap:1rem; align-items:flex-start; }
.kk-main   { flex:1; min-width:0; }
.kk-aside  { width:230px; flex-shrink:0; }
.kk-card   { background:rgba(127,127,127,.08); border:1px solid rgba(127,127,127,.25);
             border-radius:8px; padding:.8rem 1rem; margin-bottom:.8rem; }
.kk-title  { font-weight:bold; margin-bottom:.4rem; }
.kk-progress { height:6px; background:rgba(127,127,127,.2); border-radius:3px; margin:.4rem 0 .8rem; }
.kk-progress > div { height:100%; border-radius:3px; background:#c47f2c; transition:width .4s; }
.kk-cast   { display:flex; flex-wrap:wrap; gap:.4rem; margin-bottom:.6rem; }
.kk-chip   { font-size:.8rem; padding:.15rem .5rem; border-radius:999px;
             border:1px solid rgba(127,127,127,.35); }
.kk-chip.me { border-color:#c47f2c; font-weight:bold; }
.kk-log    { max-height:45vh; overflow-y:auto; padding-right:.3rem; }
.kk-scene  { margin:.6rem 0; line-height:1.45; }
.kk-scene .kk-scene-no { opacity:.6; font-size:.8rem; display:block; }
.kk-result { margin:.4rem 0; font-style:italic; opacity:.85; }
.kk-roll   { margin:.4rem 0; font-family:monospace; }
.kk-moment { margin:.5rem 0; padding-left:.8rem; border-left:3px solid #c47f2c; }
.kk-ending { margin-top:.8rem; padding:.8rem; border:1px solid #c47f2c; border-radius:8px; }
.kk-opts   { display:flex; flex-direction:column; gap:.5rem; margin-top:.6rem; }
.kk-opts button { text-align:left; padding:.5rem .8rem; }
.kk-opts button.kk-picked { outline:2px solid #c47f2c; }
.kk-wait   { opacity:.7; font-style:italic; margin-top:.5rem; }
.kk-hook   { opacity:.75; font-size:.85rem; margin:.2rem 0 .6rem; }
.kk-chron li { margin:.2rem 0; }
.kk-row    { display:flex; gap:.5rem; margin:.4rem 0; }
.kk-row input[type=text], .kk-row textarea { flex:1; }
.kk-small  { font-size:.85rem; opacity:.8; }
.kk-suggest label { display:block; margin:.4rem 0; }
`;

// OData access to the plugin's own service. Dev: mocked basic auth travels in
// the X-Authorization cookie (same one the WS uses); behind the approuter the
// session cookie is enough and the header is simply absent.
function authHeaders() {
  const m = document.cookie.match(/X-Authorization=([^;]+)/);
  return m ? { Authorization: decodeURIComponent(m[1]) } : {};
}

async function odata(method, path, body) {
  const res = await fetch(`/odata/v4/kaffee-kwest/${path}`, {
    method,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.status === 204 ? null : res.json();
}

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default {
  mount(rootEl, sdk) {
    let pub  = null;    // last public state
    let priv = null;    // own private slice (role + hook)
    let myVote = null;  // my picked option on the current node
    let lastNodeId = null;

    // party as the host needs it for prepare(); everyone tracks it anyway
    const party = [{ symbol: sdk.me.symbol, user: sdk.me.user, isHost: sdk.me.isHost }];

    rootEl.innerHTML = `
      <style>${CSS}</style>
      <div class="kk-layout">
        <div class="kk-main" id="kk-main"></div>
        <aside class="kk-aside">
          <h3>Spieler</h3><div id="kk-players"></div>
          <h3 style="margin-top:1rem">Chat</h3><div id="kk-chat" style="height:240px"></div>
        </aside>
      </div>`;
    const main = rootEl.querySelector('#kk-main');

    const cleanupPlayers = mountPlayers(rootEl.querySelector('#kk-players'), sdk, [sdk.me]);
    const cleanupChat    = mountChat(rootEl.querySelector('#kk-chat'), sdk);

    // ── lobby ─────────────────────────────────────────────────
    async function renderLobby() {
      pub = null; priv = null; myVote = null; lastNodeId = null;
      main.innerHTML = `
        <div class="kk-card">
          <div class="kk-title">☕ Kaffee-Kwest</div>
          <div class="kk-small">Ein 10–20-Minuten-Abenteuer. Eure Charaktere wachsen über
          Runden hinweg — nicht über Stats, sondern über ihre Chronik.</div>
        </div>
        <div class="kk-card">
          <div class="kk-title">Dein Charakter</div>
          <div class="kk-row"><input type="text" id="kk-arch" maxlength="255"
            placeholder="Archetyp, z. B. 'neugierig, redet sich gern raus'">
            <button id="kk-arch-save">Speichern</button></div>
          <div class="kk-title" style="margin-top:.6rem">Chronik</div>
          <ul class="kk-chron" id="kk-chron"><li class="kk-small">…</li></ul>
        </div>
        <div class="kk-card" id="kk-host-panel"></div>`;

      odata('GET', 'myProfile()').then(d => { main.querySelector('#kk-arch').value = d?.value ?? ''; }).catch(() => {});
      refreshChronicle();
      main.querySelector('#kk-arch-save').onclick = async () => {
        try {
          await odata('POST', 'saveProfile', { archetype: main.querySelector('#kk-arch').value });
          sdk.toast('Archetyp gespeichert');
        } catch { sdk.toast('Speichern fehlgeschlagen'); }
      };

      const panel = main.querySelector('#kk-host-panel');
      if (!sdk.me.isHost) {
        panel.innerHTML = `<div class="kk-wait">Warte, bis der Host das Abenteuer startet…</div>`;
        return;
      }
      panel.innerHTML = `<div class="kk-title">Abenteuer wählen</div>
        <div class="kk-row"><select id="kk-scenario"></select></div>
        <div class="kk-small" id="kk-premise"></div>
        <div class="kk-row"><button id="kk-start">Abenteuer vorbereiten &amp; starten</button></div>
        <div class="kk-small" id="kk-start-hint"></div>`;
      try {
        const { value: scenarios } = await odata('GET', 'Scenarios');
        const sel = panel.querySelector('#kk-scenario');
        sel.innerHTML = scenarios.map(s => `<option value="${esc(s.ID)}">${esc(s.title)}</option>`).join('');
        const showPremise = () => {
          const s = scenarios.find(x => x.ID === sel.value);
          panel.querySelector('#kk-premise').textContent = s ? `${s.premise} (${s.tone})` : '';
        };
        sel.onchange = showPremise; showPremise();
      } catch { panel.querySelector('#kk-premise').textContent = 'Szenarien konnten nicht geladen werden.'; }

      panel.querySelector('#kk-start').onclick = async () => {
        if (party.length < 2) { sdk.toast('Mindestens 2 Spieler nötig'); return; }
        const btn = panel.querySelector('#kk-start');
        btn.disabled = true;
        panel.querySelector('#kk-start-hint').textContent = 'Die Geschichte wird gewoben…';
        try {
          const { value: settings } = await odata('POST', 'prepare', {
            scenario: panel.querySelector('#kk-scenario').value,
            party: JSON.stringify(party),
          });
          sdk.send('configure', { room: sdk.room.id, settings });
          sdk.send('start',     { room: sdk.room.id });
        } catch (e) {
          btn.disabled = false;
          panel.querySelector('#kk-start-hint').textContent = '';
          sdk.toast('Vorbereitung fehlgeschlagen'); console.error(e);
        }
      };
    }

    async function refreshChronicle() {
      const ul = main.querySelector('#kk-chron');
      if (!ul) return;
      try {
        const { value } = await odata('GET', 'MyChronicle');
        ul.innerHTML = value.length
          ? value.map(e => `<li>${esc(e.text)}</li>`).join('')
          : '<li class="kk-small">Noch leer — ein unbeschriebenes Blatt.</li>';
      } catch { ul.innerHTML = '<li class="kk-small">Chronik nicht ladbar.</li>'; }
    }

    // ── story ─────────────────────────────────────────────────
    function renderStory() {
      if (!pub) return;
      const total = pub.sceneTotal ?? 5;
      const scene = Math.min(pub.sceneNo, total);
      const amActive = pub.symbols?.includes(sdk.me.symbol);

      main.innerHTML = `
        <div class="kk-card">
          <div class="kk-title">„${esc(pub.title)}“ — Szene ${scene} von ${total}</div>
          <div class="kk-progress"><div style="width:${Math.round(scene / total * 100)}%"></div></div>
          <div class="kk-cast">${(pub.symbols ?? []).map(s => `
            <span class="kk-chip${s === sdk.me.symbol ? ' me' : ''}">${esc(s)} · ${esc(pub.casting?.[s]?.role ?? '?')}</span>`).join('')}
          </div>
          ${priv?.me ? `<div class="kk-hook">Dein Haken: ${esc(priv.me.hook)}</div>` : ''}
          <div class="kk-log" id="kk-log">${renderLog(pub.log ?? [])}</div>
        </div>
        <div class="kk-card" id="kk-mechanic"></div>`;

      const logEl = main.querySelector('#kk-log');
      logEl.scrollTop = logEl.scrollHeight;
      renderMechanic(main.querySelector('#kk-mechanic'), amActive);
    }

    function renderLog(log) {
      return log.map(e => {
        switch (e.kind) {
          case 'scene':  return `<p class="kk-scene"><span class="kk-scene-no">Szene ${e.scene}</span>${esc(e.text)}</p>`;
          case 'result': return `<p class="kk-result">${esc(e.text)}</p>`;
          case 'roll':   return `<div class="kk-roll">🎲 ${esc(e.by)} würfelt: ${e.die}${e.bonus ? (e.bonus > 0 ? ` + ${e.bonus}` : ` − ${-e.bonus}`) : ''} = ${e.total} (Ziel ${e.target}) — ${e.success ? 'Erfolg!' : 'Fehlschlag!'}</div>`;
          case 'moment': return `<blockquote class="kk-moment">„${esc(e.text)}“ — ${esc(e.by)}</blockquote>`;
          case 'ending': return `<div class="kk-ending"><strong>${esc(e.title)}</strong><p>${esc(e.text)}</p></div>`;
          default:       return '';
        }
      }).join('');
    }

    function renderMechanic(el, amActive) {
      if (pub.phase === 'ended') { renderFinale(el); return; }
      const n = pub.node;
      if (!n) { el.innerHTML = '<div class="kk-wait">…</div>'; return; }

      if (n.mechanic === 'vote') {
        const votedCount = Object.keys(pub.votes ?? {}).length;
        el.innerHTML = `
          <div class="kk-title">Gruppenentscheidung</div>
          <div class="kk-opts">${n.options.map((label, i) => `
            <button data-opt="${i}" class="${myVote === i ? 'kk-picked' : ''}"
              ${amActive ? '' : 'disabled'}>${esc(label)}</button>`).join('')}
          </div>
          <div class="kk-small" style="margin-top:.5rem">
            ${votedCount}/${pub.symbols.length} haben abgestimmt
            ${Object.keys(pub.votes ?? {}).map(s => esc(s)).join(' ')}
          </div>
          ${sdk.me.symbol === pub.host ? `<div class="kk-row"><button id="kk-force" class="kk-small">Jetzt auflösen (Host)</button></div>` : ''}`;
        el.querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
          myVote = +b.dataset.opt;
          sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ type: 'vote', option: myVote }) });
          renderStory();
        });
        el.querySelector('#kk-force')?.addEventListener('click', () =>
          sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ type: 'forceVote' }) }));

      } else if (n.mechanic === 'roll') {
        const mine = n.roll.symbol === sdk.me.symbol;
        const bonus = n.roll.bonus ? (n.roll.bonus > 0 ? ` + ${n.roll.bonus} Bonus` : ` − ${-n.roll.bonus} Malus`) : '';
        el.innerHTML = `
          <div class="kk-title">Würfelprobe</div>
          ${mine
            ? `<div>Du bist dran! W20${bonus}, Ziel ${n.roll.target}.</div>
               <div class="kk-row"><button id="kk-roll">🎲 Würfeln</button></div>`
            : `<div class="kk-wait">⏳ ${esc(n.roll.symbol)} · ${esc(pub.casting?.[n.roll.symbol]?.role ?? '')} würfelt (Ziel ${n.roll.target})…</div>`}`;
        el.querySelector('#kk-roll')?.addEventListener('click', () =>
          sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ type: 'roll' }) }));

      } else if (n.mechanic === 'moment') {
        const mine = n.actor === sdk.me.symbol;
        el.innerHTML = `
          <div class="kk-title">Einzelmoment</div>
          ${mine
            ? `<div>${esc(n.prompt)}</div>
               <div class="kk-row"><textarea id="kk-text" maxlength="140" rows="2"></textarea></div>
               <div class="kk-row"><button id="kk-send">Absenden</button>
               <span class="kk-small" id="kk-count">0/140</span></div>`
            : `<div class="kk-wait">⏳ ${esc(n.actor)} · ${esc(pub.casting?.[n.actor]?.role ?? '')} erlebt einen Einzelmoment…</div>`}`;
        const ta = el.querySelector('#kk-text');
        ta?.addEventListener('input', () => { el.querySelector('#kk-count').textContent = `${ta.value.length}/140`; });
        el.querySelector('#kk-send')?.addEventListener('click', () => {
          if (ta.value.trim())
            sdk.send('move', { room: sdk.room.id, data: JSON.stringify({ type: 'moment', text: ta.value.trim() }) });
        });
      }
    }

    // ── finale ────────────────────────────────────────────────
    async function renderFinale(el) {
      el.innerHTML = `
        <div class="kk-title">Finale — ${esc(pub.ending?.title ?? '')}</div>
        <div class="kk-small">Chronik-Vorschläge werden gesammelt…</div>
        <div class="kk-suggest" id="kk-suggest"></div>
        <div id="kk-hostend" class="kk-row"></div>`;

      if (sdk.me.isHost) {
        el.querySelector('#kk-hostend').innerHTML =
          `<button id="kk-rematch">Nochmal (neuer Seed)</button>
           <button id="kk-back">Zurück zur Lobby</button>`;
        el.querySelector('#kk-rematch').onclick = () => sdk.send('rematch',     { room: sdk.room.id });
        el.querySelector('#kk-back').onclick    = () => sdk.send('backToLobby', { room: sdk.room.id });
      }

      const box = el.querySelector('#kk-suggest');
      if (!pub.symbols?.includes(sdk.me.symbol)) { el.querySelector('.kk-small').textContent = ''; return; }
      try {
        const { value: suggestions } = await odata('POST', 'suggestChronicle', { finalState: JSON.stringify(pub) });
        el.querySelector('.kk-small').textContent = suggestions.length
          ? 'Was davon soll in deine Chronik? (Du hast das Veto.)'
          : 'Diesmal kein prägender Moment für deine Chronik — auch okay.';
        if (!suggestions.length) return;
        box.innerHTML = suggestions.map((s, i) =>
          `<label><input type="checkbox" checked data-i="${i}"> ${esc(s)}</label>`).join('') +
          `<div class="kk-row"><button id="kk-chron-save">In Chronik übernehmen</button></div>`;
        box.querySelector('#kk-chron-save').onclick = async () => {
          const picked = [...box.querySelectorAll('input:checked')].map(c => suggestions[+c.dataset.i]);
          try {
            await odata('POST', 'saveChronicle', { entries: picked, scenario: pub.scenario ?? '' });
            box.innerHTML = `<div class="kk-small">✓ ${picked.length} Eintrag/Einträge übernommen.</div>`;
          } catch { sdk.toast('Chronik-Update fehlgeschlagen'); }
        };
      } catch { el.querySelector('.kk-small').textContent = 'Vorschläge nicht ladbar.'; }
    }

    // ── event wiring ──────────────────────────────────────────
    const onState = raw => {
      const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (s.nodeId !== lastNodeId) { myVote = null; lastNodeId = s.nodeId; }
      pub = s;
      renderStory();
    };
    const onStarted   = ({ state }) => { sdk.toast('Das Abenteuer beginnt!'); onState(state); };
    const onMoved     = ({ data })  => onState(data);
    const onFinished  = ({ state }) => onState(state);
    const onRematched = ({ state }) => { sdk.toast('Neue Runde!'); onState(state); };
    const onPrivate   = ({ data })  => { priv = typeof data === 'string' ? JSON.parse(data) : data; if (pub) renderStory(); };
    const onLobby     = () => renderLobby();
    const onError     = ({ message }) => sdk.toast(message);
    const onJoined    = ({ player, symbol, host }) => {
      if (!party.find(p => p.user === player)) party.push({ symbol, user: player, isHost: !!host });
      if (!pub) renderLobby();   // refresh player count hint
    };
    const onGone      = ({ player }) => {
      const i = party.findIndex(p => p.user === player);
      if (i >= 0) party.splice(i, 1);
    };

    sdk.on('started',      onStarted);
    sdk.on('moved',        onMoved);
    sdk.on('finished',     onFinished);
    sdk.on('rematched',    onRematched);
    sdk.on('privateState', onPrivate);
    sdk.on('lobbyReset',   onLobby);
    sdk.on('gameError',    onError);
    sdk.on('joined',       onJoined);
    sdk.on('playerLeft',   onGone);
    sdk.on('playerKicked', onGone);

    renderLobby();

    return () => {
      cleanupPlayers?.();
      cleanupChat?.();
      sdk.off('started',      onStarted);
      sdk.off('moved',        onMoved);
      sdk.off('finished',     onFinished);
      sdk.off('rematched',    onRematched);
      sdk.off('privateState', onPrivate);
      sdk.off('lobbyReset',   onLobby);
      sdk.off('gameError',    onError);
      sdk.off('joined',       onJoined);
      sdk.off('playerLeft',   onGone);
      sdk.off('playerKicked', onGone);
    };
  }
};
