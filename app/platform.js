/**
 * platform.js — CAP Games Shell (thin, but owns more than games now)
 *
 * Owns: login, lobby, WS transport, room lifecycle, header/nav, AND the
 * entire room chrome — players list, chat, host controls (switch-game,
 * start, rematch, back-to-room) and the room's live roster (sdk.players).
 *
 * A game module is only ever mounted (`game.mount(rootEl, sdk)`) once a match
 * is actually starting/active — never while the room is just waiting for
 * players. Games therefore never need to track their own roster or render
 * any pre-start "lobby" UI; they render gameplay and nothing else. Optional
 * `game.renderSettings(el, sdk)` lets a game contribute its own pre-start
 * configuration (e.g. a menu preset), shown inside the platform's waiting
 * room, host-only.
 */
import { makeSdk, makeEmitter } from './sdk.js';
import { mountPlayers } from './shell/players.js';
import { mountChat } from './shell/chat.js';
import { mountWaitingRoom } from './shell/host.js';
import { renderBrandMark } from './brand-logo.js';

// ── State ────────────────────────────────────────────────────
const shell = {
  user:   null,   // { id, authHeader } — authHeader only set in local dev (mocked auth)
  mode:   null,   // 'mocked' | 'ias' — drives what the header "Log in" does
  room:   null,   // { id, code, game }
  me:     null,   // { user, spectator, isHost }
  sdk:    null,   // built once per room session, reused across waiting-room/match/switchGame
  players: [],    // live roster — the canonical sdk.players array, mutated in place
  gameModule:     null, // currently loaded game module ({ mount, renderSettings? })
  matchUnmount:   null, // cleanup for an active game.mount()
  waitingUnmount: null, // cleanup for the waiting-room controls (shell/host.js)
  playersUnmount: null, // cleanup for the persistent players component
  chatUnmount:    null, // cleanup for the persistent chat component
};

let ws      = null;
let emitter = makeEmitter();

// Re-render the header whenever a profile resolves (own gamertag/avatar may
// arrive asynchronously after the initial login render). Global/always-on —
// profile lookups can happen both inside and outside a room.
emitter.on('profilesUpdated', () => { if (shell.user) renderAccount(); });

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'];  // local dev only

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Auth ──────────────────────────────────────────────────────
// Two modes, distinguished at boot by probing whoami:
//   • IAS (deployed):  the approuter session cookie carries auth; we send NO
//     Authorization header. Login/registration happen on the IAS-hosted page.
//   • mocked (local dev): pick a player → send a Basic auth header ourselves.
function devLogin(userId) {
  const b64 = btoa(`${userId}:${userId}`);
  document.cookie = `X-Authorization=Basic ${b64}; path=/`;   // WS auth in dev
  shell.user = { id: userId, authHeader: `Basic ${b64}` };
  sessionStorage.setItem('user', userId);
}

function logout() {
  closeAccountMenu();
  if (shell.user?.authHeader) {                 // local dev
    document.cookie = 'X-Authorization=; path=/; max-age=0';
    sessionStorage.removeItem('user');
    if (ws) wsClose();
    shell.user = null;
    shell.mode = 'mocked';
    renderAccount();
    showView('landing');
  } else {                                       // IAS: approuter clears the session
    window.location = '/logout';
  }
}

/**
 * Probe identity AND mode in a single whoami() call — its response already
 * distinguishes every case, so no separate mode endpoint is needed:
 *   • 401 / opaque redirect → the approuter's IAS gate answered an anonymous
 *     fetch → deployed, not logged in → public landing (IAS login button).
 *   • 200 'anonymous'       → local mocked auth, no player picked → dev picker.
 *   • 200 <id>              → authenticated (IAS session or dev-restored) → lobby.
 * redirect:'manual' keeps a stray 302 from being silently followed to a
 * cross-origin login page (it surfaces as an opaque response instead).
 *   → { id }      authenticated
 *   → { mocked }  local mocked auth — pick a player
 *   → { ias }     IAS in front, not logged in — public landing
 *
 * NB: this relies on whoami() being reachable anonymously (no @requires). Under
 * IAS the approuter gates it (→ 401); under mocked auth CAP answers 'anonymous'.
 */
async function probeAuth() {
  try {
    const headers = { Accept: 'application/json' };
    if (shell.user?.authHeader) headers.Authorization = shell.user.authHeader;   // dev only
    const res = await fetch('/odata/v4/lobby/whoami()', { headers, redirect: 'manual' });
    if (res.type === 'opaqueredirect' || res.status === 0 || res.status === 401) return { ias: true };
    if (res.ok) {
      const body = await res.json();
      const id = body.value ?? body;
      return (id && id !== 'anonymous') ? { id } : { mocked: true };
    }
    return { ias: true };
  } catch {
    return { ias: true };
  }
}

// ── Views ─────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.sh-view').forEach(v => v.hidden = true);
  const el = document.getElementById('view-' + name);
  if (el) el.hidden = false;
}

// ── Theme (light/dark) ──────────────────────────────────────────
// Applied via [data-theme] on <html> — style.css defines both palettes
// under the same variable names. index.html/logout.html set the initial
// value inline (before first paint, no flash); this just handles toggling
// + persistence for the running session.
const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4' +
  'M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const btn = $('sh-theme-toggle');
  if (btn) btn.innerHTML = theme === 'light' ? ICON_MOON : ICON_SUN;
}
function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}
$('sh-theme-toggle').onclick = toggleTheme;
applyTheme(document.documentElement.dataset.theme ?? 'dark'); // sync button glyph to the inline pre-paint choice

// ── Account control (header, top-right) ───────────────────────
// One control, three shapes:
//   • logged in       → avatar circle (initials); menu = name + Logout
//   • anonymous mocked → "Log in" button; menu = mock-user picker
//   • anonymous ias    → "Log in" button; click → IAS login page
function initials(id) {
  if (!id) return '?';
  const parts = id.split('@')[0].split(/[.\-_ ]+/).filter(Boolean);
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 1);
  return chars.toUpperCase();
}

function toggleAccountMenu() { const m = $('sh-account-menu'); m.hidden = !m.hidden; }
function closeAccountMenu()  { $('sh-account-menu').hidden = true; }

function renderAccount() {
  const btn  = $('sh-account-btn');
  const menu = $('sh-account-menu');
  menu.hidden = true;
  menu.innerHTML = '';
  $('sh-account').hidden = false;

  if (shell.user) {                              // logged in → avatar + logout menu
    const name = nameOf(shell.user.id);
    const avatar = avatarUrlOf(shell.user.id);
    btn.className = 'sh-account-btn sh-avatar';
    btn.innerHTML = avatar ? `<img src="${avatar}" alt="">` : '';
    if (!avatar) btn.textContent = initials(name);
    btn.title = name;
    menu.innerHTML =
      `<div class="sh-account-name">${name}</div>` +
      (shell.room ? '' : `<button class="sh-menu-item" data-act="profile">Edit profile</button>`) +
      `<button class="sh-menu-item" data-act="logout">Logout</button>`;
    menu.querySelector('[data-act="profile"]')?.addEventListener('click',
      () => { closeAccountMenu(); showProfilePage(); });
    menu.querySelector('[data-act="logout"]').onclick = logout;
    btn.onclick = toggleAccountMenu;
  } else if (shell.mode === 'mocked') {          // local → pick a mock player
    btn.className = 'sh-account-btn';
    btn.textContent = 'Log in';
    btn.title = '';
    menu.innerHTML = USERS.map(u =>
      `<button class="sh-menu-item" data-user="${u}">${u}</button>`).join('');
    menu.querySelectorAll('[data-user]').forEach(b =>
      b.onclick = () => { closeAccountMenu(); devLogin(b.dataset.user); enterLobby(b.dataset.user); });
    btn.onclick = toggleAccountMenu;
  } else {                                       // IAS → straight to the login page
    btn.className = 'sh-account-btn';
    btn.textContent = 'Log in';
    btn.title = '';
    btn.onclick = () => { window.location = '/login.html'; };
  }
}

// Close the menu when clicking anywhere outside the account control.
document.addEventListener('click', e => {
  const acc = $('sh-account');
  if (acc && !acc.hidden && !acc.contains(e.target)) closeAccountMenu();
});

// ── OData ─────────────────────────────────────────────────────
async function odata(method, path, body) {
  return serviceCall('lobby', method, path, body);
}

// Generic OData call against any platform service (lobby/profile/...).
async function serviceCall(service, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (shell.user?.authHeader) headers.Authorization = shell.user.authHeader;   // dev only
  const res = await fetch(`/odata/v4/${service}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error?.message || text; } catch { /* not JSON — use raw text */ }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

// ── Profiles (gamertag + avatar) — a display layer over the stable `user`
// id used everywhere else. Own writes go through dedicated actions; reads
// are batch-resolved and cached here, then exposed to games only via
// sdk.nameOf()/sdk.avatarUrl() — no game ever talks to ProfileService itself.
const profiles = new Map(); // user -> { gamertag, hasAvatar }

function nameOf(user) { return profiles.get(user)?.gamertag || user; }
function avatarUrlOf(user) {
  return profiles.get(user)?.hasAvatar
    ? `/odata/v4/profile/Profiles(user='${encodeURIComponent(user)}')/avatar`
    : null;
}

async function ensureProfiles(users) {
  const missing = [...new Set(users)].filter(u => u && !profiles.has(u));
  if (!missing.length) return;
  missing.forEach(u => profiles.set(u, { gamertag: '', hasAvatar: false })); // avoid duplicate concurrent fetches
  try {
    const data = await serviceCall('profile', 'POST', 'profilesOf', { users: missing });
    for (const p of data.value ?? []) profiles.set(p.user, { gamertag: p.gamertag, hasAvatar: p.hasAvatar });
  } catch (e) {
    // keep the empty placeholders — falls back to raw id/initials — but
    // don't swallow the error silently, or a real backend failure (e.g. a
    // missing Profiles table) looks identical to "nobody set a gamertag".
    console.error('profilesOf failed:', e);
  }
  emitter.emit('profilesUpdated', {});
}

// ── WebSocket ─────────────────────────────────────────────────
// Auto-reconnect: a dropped socket (network blip, backgrounded tab, laptop
// sleep) must not silently strand the player — the server now holds a 60s
// reconnect grace in ANY room status, but that's useless unless the client
// actually reopens the socket and re-sends 'join'. `intentionalClose` tells
// onclose to stay quiet for deliberate closes (leave/logout).
let reconnectTimer    = null;
let reconnectAttempts = 0;
let intentionalClose  = false;

function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/play`);

  ws.onopen = () => {
    clearTimeout(reconnectTimer);
    const wasReconnect = reconnectAttempts > 0;
    reconnectAttempts = 0;
    if (shell.room) wsSend('join', { room: shell.room.id });
    if (wasReconnect) toast('Reconnected');
  };

  ws.onmessage = ({ data }) => {
    const { event, data: payload } = JSON.parse(data);
    if (payload) emitter.emit(event, payload);
  };

  ws.onclose = () => {
    if (intentionalClose) { intentionalClose = false; return; }
    if (!shell.room) return;   // not in a room — nothing to resume
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 8000);
    reconnectAttempts++;
    toast('Connection lost — reconnecting…');
    reconnectTimer = setTimeout(wsConnect, delay);
  };
}

function wsClose() {
  intentionalClose = true;
  clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  ws?.close();
  ws = null;
}

function wsSend(action, data) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event: action, data }));
}

// ── Header toast ──────────────────────────────────────────────
function toast(msg) {
  const el = $('sh-toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3000);
}

// ── Room lifecycle ────────────────────────────────────────────
async function joinByCode(input) {
  // Accept either a 4-char code or a full UUID (backwards compat)
  const isCode = /^[A-Z0-9]{4}$/i.test(input.trim());
  const filter = isCode
    ? `code eq '${input.trim().toUpperCase()}'`
    : `ID eq '${input.trim()}'`;
  const data = await odata('GET', `Rooms?$filter=${filter}`).catch(() => null);
  const room = data?.value?.[0];
  if (!room) { toast('Room not found'); return; }
  await joinRoom(room.ID, room.code, room.game);
}

// ── Roster maintenance — the canonical sdk.players array, kept correct for
// the room's whole lifetime regardless of which/whether a game is mounted.
function onRoster({ players }) {
  try {
    const list = JSON.parse(players);
    shell.players.length = 0;
    shell.players.push(...list);
    ensureProfiles(list.map(p => p.user));
  } catch { /* ignore malformed payload */ }
}
function onPlayerLeftRoster({ player }) {
  const i = shell.players.findIndex(p => p.user === player);
  if (i >= 0) shell.players.splice(i, 1);
}
function onPlayerKickedRoster({ player }) { onPlayerLeftRoster({ player }); }
function onRoleChangedRoster({ player, spectator }) {
  const p = shell.players.find(p => p.user === player);
  if (p) p.spectator = spectator;
}

// ── Kick route — shell handles because a game may not listen ──
function onSelfKicked({ player }) {
  if (player === shell.user?.id) { toast('You were kicked'); leaveRoom(); }
}

// ── Errors — surfaced generically so games don't each need their own handler
function onGameError({ message }) { if (message) toast(message); }

// ── Match controls — host-only, generic across every game, so no game
// needs its own. 'active': a single "Abort match" button, shown once a
// match has started (backToRoom is legal from 'playing'/'paused' too, not
// just 'finished' — srv/engine.js's TRANSITIONS table). 'finished':
// Rematch / Back to room. Falsy: empty (room reset, game switch).
function renderMatchControls(mode) {
  const el = $('room-match-controls');
  if (!mode || !shell.me?.isHost) { el.innerHTML = ''; return; }
  el.innerHTML = mode === 'finished'
    ? `<div class="sh-host-controls">
         <button id="sh-btn-rematch">Rematch</button>
         <button id="sh-btn-backroom">Back to room</button>
       </div>`
    : `<div class="sh-host-controls">
         <button id="sh-btn-abort" class="sh-ghost">Abort match</button>
       </div>`;
  el.querySelector('#sh-btn-rematch')?.addEventListener('click', () => sdk_send('rematch'));
  el.querySelector('#sh-btn-backroom')?.addEventListener('click', () => sdk_send('backToRoom'));
  el.querySelector('#sh-btn-abort')?.addEventListener('click',    () => sdk_send('backToRoom'));
  function sdk_send(action) { wsSend(action, { room: shell.room.id }); }
}
function onFinishedControls()  { renderMatchControls('finished'); }
function onClearedControls()   { renderMatchControls(false); }

// ── Waiting-room ↔ match transitions — the core state machine. A game
// module is mounted ONLY once a match is actually starting/active; before
// that (status 'lobby') the platform's own waiting room owns #game-root.
// A game's optional `meta.layout` ({ areas, columns, rows } — raw
// grid-template-* values) repositions/resizes the roster/chat panels
// around its board. #room-players/#room-chat are never touched here —
// only .gm-layout's grid placement changes — so mountPlayers/mountChat's
// state (chat scrollback, roster list) survives untouched.
function applyRoomLayout() {
  const el = $('room-layout');
  const layout = shell.gameModule?.meta?.layout;
  el.dataset.game = shell.room?.game ?? '';
  const setVar = (name, value) => value ? el.style.setProperty(name, value) : el.style.removeProperty(name);
  setVar('--gm-areas', layout?.areas);
  setVar('--gm-cols',  layout?.columns);
  setVar('--gm-rows',  layout?.rows);
}

function mountGame() {
  const el = $('game-root');
  el.innerHTML = '';
  el.classList.add('gm-game-active');   // opt this game's DOM out of shell chrome styling — see style.css
  shell.matchUnmount = shell.gameModule.mount(el, shell.sdk) ?? null;
}

async function showWaitingRoom() {
  const el = $('game-root');
  el.innerHTML = '';
  el.classList.remove('gm-game-active');
  shell.waitingUnmount = await mountWaitingRoom(el, shell.sdk, shell.gameModule) ?? null;
}

function onStartedTopLevel(payload) {
  if (shell.waitingUnmount) {
    shell.waitingUnmount(); shell.waitingUnmount = null;
    mountGame();
    // The 'started' event that triggered this transition already fired before
    // the freshly-mounted game had a chance to register its own listener —
    // replay it now so the game's own onStarted sees its first state.
    emitter.emit('started', payload);
  }
  renderMatchControls('active');
}
function onRoomResetTopLevel() {
  if (shell.matchUnmount) { shell.matchUnmount(); shell.matchUnmount = null; }
  onClearedControls();
  showWaitingRoom();
}
async function onGameSwitchedTopLevel({ game }) {
  if (!shell.room || shell.room.game === game) return;
  shell.room.game = game;
  shell.matchUnmount?.();   shell.matchUnmount = null;
  shell.waitingUnmount?.(); shell.waitingUnmount = null;
  const mod = await import(`/games/${game}/index.js`);
  shell.gameModule = mod.default;
  applyRoomLayout();
  await showWaitingRoom();
  toast('Host switched the game');
}

async function joinRoom(roomId, code, game) {
  // resolve room details if not provided (e.g. when called from createRoom)
  if (!game) {
    const data = await odata('GET', `Rooms?$filter=ID eq '${roomId}'`).catch(() => null);
    const room = data?.value?.[0] ?? {};
    code = room.code ?? roomId;
    game = room.game ?? 'tictactoe';
  }
  shell.room = { id: roomId, code: code ?? roomId, game };

  // update header — show short code
  $('sh-room-id').textContent = shell.room.code;
  $('sh-room-id').hidden = false;
  $('sh-btn-copy').hidden = false;
  $('sh-btn-invite').hidden = false;

  // load game UI module
  const mod = await import(`/games/${game}/index.js`);
  shell.gameModule = mod.default;
  applyRoomLayout();

  // connect WS if needed — wsConnect's onopen sends 'join' once shell.room is
  // set (it already is, above), so a fresh connection auto-joins; if a socket
  // is already open, send join directly.
  if (!ws || ws.readyState > WebSocket.OPEN) wsConnect();
  else wsSend('join', { room: roomId });

  // once joined — platform sets me, mounts the persistent chrome, then either
  // the waiting room (status 'lobby') or the game itself (already active)
  emitter.on('joined', function onFirstJoin(payload) {
    if (payload.player !== shell.user.id) return;
    emitter.off('joined', onFirstJoin);

    shell.me = { user: shell.user.id, spectator: payload.spectator, isHost: payload.host };
    shell.players.length = 0; // the server's 'roster' broadcast (sent right after 'joined') fills this in

    shell.sdk = makeSdk({
      room: shell.room,
      me:   shell.me,
      players: shell.players,
      wsSend,
      emitter,
      toastFn: toast,
      leaveFn: leaveRoom,
      nameOf,
      avatarUrl: avatarUrlOf,
    });

    showView('room');
    shell.playersUnmount = mountPlayers($('room-players'), shell.sdk, []);
    shell.chatUnmount    = mountChat($('room-chat'), shell.sdk);

    // room-scoped listeners — all torn down together in leaveRoom()
    emitter.on('roster',       onRoster);
    emitter.on('playerLeft',   onPlayerLeftRoster);
    emitter.on('playerKicked', onPlayerKickedRoster);
    emitter.on('roleChanged',  onRoleChangedRoster);
    emitter.on('playerKicked', onSelfKicked);
    emitter.on('gameError',    onGameError);
    emitter.on('started',      onStartedTopLevel);
    emitter.on('finished',     onFinishedControls);
    emitter.on('rematched',    onClearedControls);
    emitter.on('roomReset',    onRoomResetTopLevel);
    emitter.on('gameSwitched', onGameSwitchedTopLevel);

    if (payload.status === 'lobby') showWaitingRoom();
    else { mountGame(); renderMatchControls(payload.status === 'finished' ? 'finished' : 'active'); }
  });
}

async function createRoom(game) {
  const { value: roomId } = await odata('POST', 'createRoom', { game });
  await joinRoom(roomId);  // joinRoom will fetch code+game since they're not passed
}

function leaveRoom() {
  if (shell.room) wsSend('leave', { room: shell.room.id });
  shell.matchUnmount?.();   shell.matchUnmount = null;
  shell.waitingUnmount?.(); shell.waitingUnmount = null;
  shell.playersUnmount?.(); shell.playersUnmount = null;
  shell.chatUnmount?.();    shell.chatUnmount = null;
  renderMatchControls(false);

  emitter.off('roster',       onRoster);
  emitter.off('playerLeft',   onPlayerLeftRoster);
  emitter.off('playerKicked', onPlayerKickedRoster);
  emitter.off('roleChanged',  onRoleChangedRoster);
  emitter.off('playerKicked', onSelfKicked);
  emitter.off('gameError',    onGameError);
  emitter.off('started',      onStartedTopLevel);
  emitter.off('finished',     onFinishedControls);
  emitter.off('rematched',    onClearedControls);
  emitter.off('roomReset',    onRoomResetTopLevel);
  emitter.off('gameSwitched', onGameSwitchedTopLevel);

  shell.room = null;
  shell.me   = null;
  shell.sdk  = null;
  shell.gameModule = null;
  shell.players.length = 0;
  $('sh-room-id').hidden = true;
  $('sh-btn-copy').hidden = true;
  $('sh-btn-invite').hidden = true;
  showView('lobby');
  loadLobby();
}

// ── Lobby ─────────────────────────────────────────────────────
async function loadLobby() {
  const data = await odata('GET', 'Games').catch(() => ({ value: [] }));
  const list = $('sh-game-list');
  list.innerHTML = (data.value ?? []).map(g => `
    <li>
      <strong>${g.name}</strong>
      <span class="sh-small">${g.minPlayers}–${g.maxPlayers} players</span>
      <button data-game="${g.id}">Create room</button>
    </li>`).join('');
  list.querySelectorAll('[data-game]').forEach(b =>
    b.onclick = () => createRoom(b.dataset.game));

  await loadOpenRooms();
}

// ── Open rooms — browse & join from the start page ─────────────
async function loadOpenRooms() {
  const roomList = $('sh-room-list');
  const data = await odata('GET', "Rooms?$filter=status ne 'finished'").catch(() => ({ value: [] }));
  const rooms = data.value ?? [];

  if (!rooms.length) {
    roomList.innerHTML = `<li class="sh-small">No open rooms right now — create one above.</li>`;
    return;
  }

  roomList.innerHTML = rooms.map(r => {
    const full = r.maxPlayers != null && r.playerCount >= r.maxPlayers;
    // Already have a seat here (e.g. disconnected mid-match)? The room may
    // look "full" from the outside, but that seat is the caller's own —
    // always offer "Reconnect", never "Spectate", for a returning member.
    const label = r.isMember ? 'Reconnect' : full ? 'Spectate' : 'Join';
    return `
    <li>
      <strong>${r.gameName ?? r.game}</strong>
      <code>${r.code}</code>
      <span class="sh-small">${r.host}</span>
      <span class="sh-small">${r.playerCount}${r.maxPlayers != null ? '/' + r.maxPlayers : ''} players${full ? ' — full' : ''}</span>
      <span class="sh-small">${r.status}</span>
      <button data-room="${r.ID}" class="sh-small">${label}</button>
    </li>`;
  }).join('');
  roomList.querySelectorAll('[data-room]').forEach(b =>
    b.onclick = () => joinRoom(b.dataset.room));
}

// ── Boot ──────────────────────────────────────────────────────

// Shareable invite links: `#/join/<CODE>` — captured into sessionStorage
// immediately (before any login redirect can strip the URL fragment) and
// consumed the moment we reach the lobby, authenticated, whichever path got
// us there (already-logged-in, dev picker, or a full IAS round trip).
(function capturePendingJoin() {
  const m = location.hash.match(/^#\/join\/([A-Za-z0-9]{4,})$/);
  if (m) {
    sessionStorage.setItem('pendingJoin', m[1].toUpperCase());
    history.replaceState(null, '', location.pathname + location.search);
  }
})();

function consumePendingJoin() {
  const code = sessionStorage.getItem('pendingJoin');
  if (!code) return;
  sessionStorage.removeItem('pendingJoin');
  joinByCode(code);
}

function enterLobby(id) {
  shell.user ??= { id, authHeader: null };
  closeAccountMenu();
  renderAccount();               // header now shows the avatar
  showView('lobby');
  loadLobby();
  ensureProfiles([id]);
  consumePendingJoin();
}

$('sh-logo-btn').onclick = () => {
  if (shell.room) leaveRoom();          // same as the Leave button — tears down room state
  else if (shell.user) { showView('lobby'); loadLobby(); }
  else showView('landing');
};

$('sh-btn-leave').onclick  = leaveRoom;
$('sh-btn-copy').onclick   = () => {
  navigator.clipboard.writeText(shell.room?.code ?? '');
  toast('Room code copied');
};
$('sh-btn-invite').onclick = () => {
  const link = `${location.origin}${location.pathname}#/join/${shell.room?.code ?? ''}`;
  if (navigator.share) {
    navigator.share({ title: 'Join my Gambito room', url: link }).catch(() => {});
  } else {
    navigator.clipboard.writeText(link);
    toast('Invite link copied');
  }
};
$('sh-join-input').onkeydown = e => { if (e.key === 'Enter') $('sh-btn-join').click(); };
$('sh-btn-join').onclick = () => {
  const id = $('sh-join-input').value.trim();
  if (id) joinByCode(id);
};
$('sh-btn-refresh-rooms').onclick = () => loadOpenRooms();

// ── Edit profile (gamertag + avatar) ────────────────────────────
// Client-side resize before upload: avoids relying solely on the server
// rejecting an oversized image — the user gets a usable avatar instead of
// an error. Downscales to a small square and re-encodes as JPEG, shrinking
// quality until the result fits under maxBytes.
async function resizeImageToLimit(file, maxBytes = 256 * 1024, maxDim = 256) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

  let quality = 0.85;
  for (let i = 0; i < 6; i++) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (blob.size <= maxBytes || quality <= 0.3) return blob;
    quality -= 0.15;
  }
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.3));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

let pendingAvatarBlob = null;

function renderProfileAvatarPreview() {
  const el = $('profile-avatar-preview');
  if (pendingAvatarBlob) {
    el.innerHTML = `<img src="${URL.createObjectURL(pendingAvatarBlob)}" alt="">`;
    return;
  }
  const url = avatarUrlOf(shell.user.id);
  el.innerHTML = url ? `<img src="${url}" alt="">` : '';
  if (!url) el.textContent = initials(nameOf(shell.user.id));
}

async function showProfilePage() {
  pendingAvatarBlob = null;
  $('profile-gamertag-input').value = profiles.get(shell.user.id)?.gamertag ?? '';
  renderProfileAvatarPreview();
  showView('profile');
}

$('profile-avatar-input').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    pendingAvatarBlob = await resizeImageToLimit(file);
    renderProfileAvatarPreview();
  } catch { toast('Could not read that image'); }
};

$('profile-save-btn').onclick = async () => {
  const tag = $('profile-gamertag-input').value.trim();
  try {
    if (tag) await serviceCall('profile', 'POST', 'saveGamertag', { gamertag: tag });
    if (pendingAvatarBlob) {
      const data = await blobToBase64(pendingAvatarBlob);
      await serviceCall('profile', 'POST', 'saveAvatar', { data, mediaType: 'image/jpeg' });
      pendingAvatarBlob = null;
    }
    profiles.delete(shell.user.id);
    await ensureProfiles([shell.user.id]);
    toast('Profile saved');
    showView('lobby');
  } catch (e) {
    toast(e.message || 'Could not save profile');
  }
};
$('profile-back-btn').onclick = () => showView('lobby');

renderBrandMark($('sh-logo-canvas'), {
  fontPx: 108, dripCount: 3, pivotXRatio: 0.03, pivotYRatio: 0.02, seed: 4242,
});
renderBrandMark($('landing-logo-canvas'), {
  withPlate: true, fontPx: 260, dripCount: 6, pivotXRatio: 0.025, pivotYRatio: 0.03,
  tagline: 'MULTIPLAYER ARCADE', seed: 1337,
});

async function boot() {
  // In local dev, restore a previously-picked mock user so whoami passes.
  const saved = sessionStorage.getItem('user');
  if (saved) devLogin(saved);

  const auth = await probeAuth();
  if (auth.id) {                       // authenticated (IAS session or dev-restored)
    shell.user ??= { id: auth.id, authHeader: null };
    enterLobby(auth.id);
  } else {                             // anonymous → landing + header "Log in"
    shell.user = null;
    shell.mode = auth.mocked ? 'mocked' : 'ias';
    renderAccount();
    showView('landing');
  }
}

boot();
