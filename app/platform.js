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
import { initTheme } from './theme.js';
import { initProfileEditing } from './profile-edit.js';
import { initAchievements } from './achievements.js';
import { initLeaderboard } from './leaderboard.js';

// ── State ────────────────────────────────────────────────────
const shell = {
  user:   null,   // { id, authHeader } — authHeader only set in local dev (mocked auth)
  mode:   null,   // 'mocked' | 'ias' — drives what the header "Log in" does
  room:   null,   // { id, code, game } — game '' for an empty (not-yet-chosen) room
  status: null,   // room status mirror: 'lobby'|'playing'|'paused'|'finished'
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
let showProfilePage = () => {};      // wired by initProfileEditing() at boot
let showAchievementsPage = () => {}; // wired by initAchievements() at boot
let showLeaderboardPage = () => {};  // wired by initLeaderboard() at boot

// Re-render the header + rail profile whenever a profile resolves (own
// gamertag/avatar may arrive asynchronously after the initial login render).
// Global/always-on — profile lookups happen both inside and outside a room.
emitter.on('profilesUpdated', () => { if (shell.user) { renderAccount(); renderRailProfile(); } });

// Achievement unlocks arrive per-user at match end (see PlayService). Global/
// always-on: the notification is the user's, not the room's. Stagger the toasts
// so several unlocks from one match are each legible, and refresh the rail tally.
emitter.on('achievementUnlocked', ({ unlocked }) => {
  let list; try { list = JSON.parse(unlocked); } catch { return; }
  (list ?? []).forEach((a, i) => setTimeout(() => toast(`🏆 ${a.name}`), i * 1600));
  loadRailStats(true);
});

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'];  // local dev only

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Placeholder cover art per game (no per-game images ship yet). glyph + a
// gradient class defined in style.css; unknown games fall back to a die.
const GAME_ART = {
  tictactoe:      { glyph: '✕', cls: 'art-a1' },
  mttt:           { glyph: '▦', cls: 'art-a5' },
  kaiten:         { glyph: '🍣', cls: 'art-a3' },
  flipfortune:    { glyph: '🃏', cls: 'art-a4' },
  kaperfahrt:     { glyph: '🏴‍☠️', cls: 'art-a2' },
  'snake-ladder': { glyph: '🐍', cls: 'art-a6' },
};

// ── Rail mini-profile (avatar + name + achievement tally) ─────
let railStats = null;   // { owned, total } — cached; refreshed on unlock

function renderRailProfile() {
  const el = $('rail-profile');
  if (!el || !shell.user) return;
  const name = nameOf(shell.user.id);
  const av   = avatarUrlOf(shell.user.id);
  el.innerHTML = `
    <div class="sh-rp-av">${av ? `<img src="${av}" alt="">` : initials(name)}</div>
    <div class="sh-rp-meta">
      <div class="sh-rp-name" title="${name}">${name}</div>
      <div class="sh-rp-sub" id="rail-profile-stats"></div>
    </div>`;
  loadRailStats();
}

function paintRailStats() {
  const el = $('rail-profile-stats');
  if (el && railStats) el.textContent = `🏆 ${railStats.owned} / ${railStats.total} unlocked`;
}

async function loadRailStats(force) {
  if (railStats && !force) { paintRailStats(); return; }
  try {
    const { value } = await serviceCall('lobby', 'GET', 'myAchievements()');
    railStats = {
      owned: (value ?? []).reduce((n, g) => n + g.owned.length, 0),
      total: (value ?? []).reduce((n, g) => n + g.total, 0),
    };
  } catch { railStats = { owned: 0, total: 0 }; }
  paintRailStats();
}

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
    railStats = null;
    closeRailRoom();
    $('sh-hamburger').hidden = true;
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

// ── Views / pages ─────────────────────────────────────────────
// Two top-level shells: the public landing, and the logged-in app (a persistent
// left rail — profile + nav + room panel — beside a main column). Within the
// app the main column shows one "page" at a time, driven by the rail nav; the
// rail is always present so the room stays visible while you browse.
const PAGE_TO_VIEW = {
  library: 'lobby', achievements: 'achievements',
  leaderboard: 'leaderboard', profile: 'profile', game: 'game',
};

function showLanding() { $('view-app').hidden = true;  $('view-landing').hidden = false; }
function showApp()     { $('view-landing').hidden = true; $('view-app').hidden = false; }

function showPage(name) {
  const id = PAGE_TO_VIEW[name] ?? name;
  $('sh-main').querySelectorAll('.sh-view').forEach(v => v.hidden = true);
  const el = $('view-' + id);
  if (el) el.hidden = false;
  document.querySelectorAll('#rail-nav .sh-nav-item')
    .forEach(b => b.classList.toggle('on', b.dataset.page === name));
}

// Back-compat shim — existing call sites and the page modules (profile/
// achievements/leaderboard) call showView('lobby'|'profile'|'achievements'|
// 'leaderboard'|'landing'); map those onto the app/page model above.
function showView(name) {
  if (name === 'landing') { showLanding(); return; }
  showApp();
  showPage(name === 'lobby' ? 'library' : name);
}

// ── Theme (light/dark) — see theme.js ─────────────────────────
initTheme();

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
    // Navigation (Library/Achievements/Leaderboard/Profile) lives in the rail
    // now — the account menu is just identity + logout.
    menu.innerHTML =
      `<div class="sh-account-name">${name}</div>` +
      `<button class="sh-menu-item" data-act="logout">Logout</button>`;
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
const profiles = new Map(); // user -> { gamertag, hasAvatar, avatarUrl }

function nameOf(user) { return profiles.get(user)?.gamertag || user; }
function avatarUrlOf(user) { return profiles.get(user)?.avatarUrl || null; }

// The avatar media stream is @requires: 'authenticated-user', and in local
// mocked dev auth rides a manually-attached Authorization header (see the
// "Auth" section above) — but a plain <img src="..."> is a browser-native
// request that can't carry a custom header, so it would 401. Fetch the bytes
// ourselves (with the same header serviceCall uses) and hand out a blob: URL
// instead, which any <img> can render regardless of auth mode.
async function fetchAvatarBlobUrl(user) {
  try {
    const headers = {};
    if (shell.user?.authHeader) headers.Authorization = shell.user.authHeader;   // dev only
    const res = await fetch(`/odata/v4/profile/Profiles(user='${encodeURIComponent(user)}')/avatar`, { headers });
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

async function ensureProfiles(users) {
  const missing = [...new Set(users)].filter(u => u && !profiles.has(u));
  if (!missing.length) return;
  missing.forEach(u => profiles.set(u, { gamertag: '', hasAvatar: false, avatarUrl: null })); // avoid duplicate concurrent fetches
  try {
    const data = await serviceCall('profile', 'POST', 'profilesOf', { users: missing });
    const list = data.value ?? [];
    for (const p of list) profiles.set(p.user, { gamertag: p.gamertag, hasAvatar: p.hasAvatar, avatarUrl: null });
    emitter.emit('profilesUpdated', {});

    const withAvatar = list.filter(p => p.hasAvatar);
    if (withAvatar.length) {
      await Promise.all(withAvatar.map(async p => {
        const url = await fetchAvatarBlobUrl(p.user);
        const cur = profiles.get(p.user);
        if (cur) profiles.set(p.user, { ...cur, avatarUrl: url });
      }));
      emitter.emit('profilesUpdated', {});
    }
    return;
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
function onFinishedControls()  { setRailStatus('finished'); renderMatchControls('finished'); }
function onClearedControls()   { setRailStatus('playing');  renderMatchControls('active'); updateSwitchHint(); }

// ── Rail room panel — persistent while you're in a room (any page/nav) ──
const STATUS_LABEL = { lobby: 'Waiting', playing: 'Playing', paused: 'Paused', finished: 'Finished' };

function openRailRoom(status) {
  $('rail-room').hidden = false;
  $('rr-code').textContent = shell.room?.code ?? '';
  setRailStatus(status);
}
function closeRailRoom() { $('rail-room').hidden = true; }
function setRailStatus(status) {
  shell.status = status;
  const el = $('rr-status');
  if (el) { el.textContent = STATUS_LABEL[status] ?? status; el.dataset.status = status; }
}

// The library shows a contextual hint when you're in a waiting room — click a
// card to set/switch the room's game (host), or wait (non-host).
function updateSwitchHint() {
  const el = $('sh-switch-hint');
  if (!el) return;
  // Only surface a hint to non-hosts (they can't act on the library); the host
  // just clicks a card, no instructional banner needed.
  if (shell.room && shell.status === 'lobby' && !shell.me?.isHost) {
    el.hidden = false;
    el.textContent = 'Waiting for the host to choose a game and start.';
  } else {
    el.hidden = true;
  }
}

// ── Waiting-room ↔ match transitions — the core state machine. A game module
// is mounted ONLY once a match is actually starting/active, into #game-root on
// the main "game" page. The roster/chat/host-controls live in the rail room
// panel and persist across the whole room session. While waiting, the main
// column stays on the Library so you can browse (and the host can switch game
// by clicking a card).
function mountGame() {
  if (!shell.gameModule) return;          // empty room — nothing to mount yet
  const host = $('game-root');
  host.innerHTML = '';                    // clear any leftover content
  host.classList.add('gm-game-active');
  // data-game on <html> (mirrors theme.js's data-theme) scopes a game's chrome
  // reskin. Set only once a match is actually mounted; cleared in
  // showWaitingRoom()/leaveRoom().
  document.documentElement.dataset.game = shell.room?.game ?? '';
  // Mount the game inside a shadow root so the platform's theme can't reach in
  // and the game's styles can't leak out. attachShadow runs once per element, so
  // reuse an existing root across rematches.
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '';
  const root = document.createElement('div');
  shadow.appendChild(root);
  shell.matchUnmount = shell.gameModule.mount(root, shell.sdk) ?? null;
  showPage('game');
  $('sh-btn-exit').hidden = false;
}

async function showWaitingRoom() {
  setRailStatus('lobby');
  $('sh-btn-exit').hidden = true;
  // tear down any game board
  const host = $('game-root');
  host.classList.remove('gm-game-active');
  if (host.shadowRoot) host.shadowRoot.innerHTML = '';
  host.innerHTML = '';
  document.documentElement.dataset.game = '';
  // waiting host-controls (start / game settings) render into the rail
  const slot = $('room-waiting');
  slot.innerHTML = '';
  shell.waitingUnmount = await mountWaitingRoom(slot, shell.sdk, shell.gameModule) ?? null;
  updateSwitchHint();
  showPage('library');                    // browse while waiting
}

function onStartedTopLevel(payload) {
  setRailStatus('playing');
  if (shell.waitingUnmount) {
    shell.waitingUnmount(); shell.waitingUnmount = null;
    mountGame();
    // The 'started' event fired before the freshly-mounted game registered its
    // own listener — replay it so the game's onStarted sees its first state.
    emitter.emit('started', payload);
  }
  renderMatchControls('active');
  updateSwitchHint();
}
function onRoomResetTopLevel() {
  if (shell.matchUnmount) { shell.matchUnmount(); shell.matchUnmount = null; }
  renderMatchControls(false);
  showWaitingRoom();
}
async function onGameSwitchedTopLevel({ game, name }) {
  if (!shell.room || shell.room.game === game) return;
  shell.room.game = game;
  shell.matchUnmount?.();   shell.matchUnmount = null;
  shell.waitingUnmount?.(); shell.waitingUnmount = null;
  const mod = await import(`/games/${game}/index.js`);
  shell.gameModule = mod.default;
  await showWaitingRoom();
  refreshLibraryActive();
  toast(`Game set to ${name ?? game}`);
}

async function joinRoom(roomId, code, game) {
  // resolve room details if not provided (e.g. when called from createRoom).
  // game may be '' for an empty room — a game is chosen later via switchGame.
  if (game == null) {
    const data = await odata('GET', `Rooms?$filter=ID eq '${roomId}'`).catch(() => null);
    const room = data?.value?.[0] ?? {};
    code = room.code ?? roomId;
    game = room.game ?? '';
  }
  shell.room = { id: roomId, code: code ?? roomId, game: game || '' };

  // update header — show short code
  $('sh-room-id').textContent = shell.room.code;
  $('sh-room-id').hidden = false;
  $('sh-btn-copy').hidden = false;
  $('sh-btn-invite').hidden = false;

  // load game UI module (skipped for an empty room — nothing to load yet)
  shell.gameModule = game ? (await import(`/games/${game}/index.js`)).default : null;

  // connect WS if needed — wsConnect's onopen sends 'join' once shell.room is
  // set (it already is, above), so a fresh connection auto-joins; if a socket
  // is already open, send join directly.
  if (!ws || ws.readyState > WebSocket.OPEN) wsConnect();
  else wsSend('join', { room: roomId });

  // once joined — platform sets me, reveals the rail room panel + mounts the
  // persistent chrome, then either the waiting room (status 'lobby') or the
  // game itself (already active).
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

    showApp();
    openRailRoom(payload.status);
    shell.playersUnmount = mountPlayers($('room-players'), shell.sdk, []);
    // A game can render its own chat UI (via sdk.chat) by declaring meta.ownsChat
    // — the platform still owns the transport/data, only the default panel is
    // skipped.
    const ownsChat = shell.gameModule?.meta?.ownsChat === true;
    $('rail-room').querySelector('.sh-rr-chat').hidden = ownsChat;
    shell.chatUnmount = ownsChat ? null : mountChat($('room-chat'), shell.sdk);

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

    refreshLibraryActive();
    if (payload.status === 'lobby') showWaitingRoom();
    else { mountGame(); renderMatchControls(payload.status === 'finished' ? 'finished' : 'active'); }
  });
}

async function createRoom(game) {
  const { value: roomId } = await odata('POST', 'createRoom', game ? { game } : {});
  await joinRoom(roomId);  // joinRoom fetches code+game since they're not passed
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
  shell.status = null;
  shell.gameModule = null;
  shell.players.length = 0;
  document.documentElement.dataset.game = '';
  $('room-waiting').innerHTML = '';
  closeRailRoom();
  $('sh-room-id').hidden = true;
  $('sh-btn-copy').hidden = true;
  $('sh-btn-invite').hidden = true;
  $('sh-btn-exit').hidden = true;
  showApp();
  showPage('library');
  updateSwitchHint();
  loadLobby();
}

// ── Library (game cards) ──────────────────────────────────────
function gameCard(g) {
  const art = GAME_ART[g.id] ?? { glyph: '🎲', cls: 'art-default' };
  const active = shell.room && shell.room.game === g.id ? ' sh-card-active' : '';
  return `
    <button class="sh-card${active}" data-game="${g.id}">
      <span class="sh-card-art ${art.cls}">${art.glyph}</span>
      <span class="sh-card-meta">
        <span class="sh-card-title">${g.name}</span>
        <span class="sh-card-sub">${g.minPlayers}–${g.maxPlayers} players</span>
      </span>
    </button>`;
}

// Clicking a game card: create a room (not in one), switch the room's game
// (host, still waiting), or explain why not.
function handleGameCard(gameId) {
  if (!shell.room)                     return createRoom(gameId);
  if (!shell.me?.isHost)               return toast('Only the host can change the game');
  if (shell.status !== 'lobby')        return toast('Finish or leave the current match first');
  if (shell.room.game === gameId)      return toast('Your room is already on this game');
  wsSend('switchGame', { room: shell.room.id, game: gameId });
}

// Reflect which card is the current room's game (highlight), without a reload.
function refreshLibraryActive() {
  document.querySelectorAll('#sh-game-list .sh-card').forEach(c =>
    c.classList.toggle('sh-card-active', !!shell.room && c.dataset.game === shell.room.game));
  updateSwitchHint();
}

async function loadLobby() {
  const data = await odata('GET', 'Games').catch(() => ({ value: [] }));
  const list = $('sh-game-list');
  list.innerHTML = (data.value ?? []).map(gameCard).join('');
  list.querySelectorAll('[data-game]').forEach(b =>
    b.onclick = () => handleGameCard(b.dataset.game));
  updateSwitchHint();
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
      <strong>${r.gameName || r.game || 'Empty room'}</strong>
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
  $('sh-hamburger').hidden = false;   // rail toggle only makes sense once logged in
  renderAccount();                    // header avatar
  renderRailProfile();                // rail mini-profile
  showApp();
  showPage('library');
  loadLobby();
  ensureProfiles([id]);
  consumePendingJoin();
}

$('sh-logo-btn').onclick = () => {
  if (shell.room) leaveRoom();          // same as the Leave button — tears down room state
  else if (shell.user) { showApp(); showPage('library'); loadLobby(); }
  else showView('landing');
};

// Rail navigation — Library / Achievements / Leaderboard / Edit profile.
document.querySelectorAll('#rail-nav .sh-nav-item').forEach(b => b.onclick = () => {
  switch (b.dataset.page) {
    case 'library':      showApp(); showPage('library'); loadOpenRooms(); break;
    case 'achievements': showAchievementsPage(); break;
    case 'leaderboard':  showLeaderboardPage();  break;
    case 'profile':      showProfilePage();      break;
  }
});
$('sh-hamburger').onclick    = () => $('view-app').classList.toggle('rail-collapsed');
$('sh-btn-empty-room').onclick = () => createRoom();   // no game → empty room, pick later
$('rr-leave').onclick        = leaveRoom;

$('sh-btn-exit').onclick   = leaveRoom;
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

// ── Edit profile (gamertag + avatar) — see profile-edit.js ──────
({ showProfilePage } = initProfileEditing({
  $, serviceCall, profiles, ensureProfiles, nameOf, avatarUrlOf, initials,
  getUserId: () => shell.user?.id, toast, showView,
}));

({ showAchievementsPage } = initAchievements({ $, serviceCall, showView }));

({ showLeaderboardPage } = initLeaderboard({
  $, serviceCall, showView, getUserId: () => shell.user?.id,
}));

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
