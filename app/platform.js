/**
 * platform.js — CAP Games Shell (thin)
 *
 * Owns: login, lobby, WS transport, room lifecycle, header/nav.
 * Does NOT own: game rendering, board, chat, player list, host controls.
 * Those are handled by game UI (mount) + optional shell components.
 */
import { makeSdk, makeEmitter } from './sdk.js';

// ── State ────────────────────────────────────────────────────
const shell = {
  user:    null,   // { id, authHeader }
  room:    null,   // { id, game }
  me:      null,   // { user, symbol, isHost }
  game:    null,   // loaded game module { mount }
  unmount: null,   // cleanup fn returned by game.mount()
};

let ws      = null;
let emitter = makeEmitter();

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'];

// ── DOM ───────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Auth ──────────────────────────────────────────────────────
function login(userId) {
  const b64 = btoa(`${userId}:${userId}`);
  document.cookie = `X-Authorization=Basic ${b64}; path=/`;
  shell.user = { id: userId, authHeader: `Basic ${b64}` };
  sessionStorage.setItem('user', userId);
}

function logout() {
  document.cookie = 'X-Authorization=; path=/; max-age=0';
  sessionStorage.removeItem('user');
  if (ws) { ws.close(); ws = null; }
  shell.user = null;
  showView('login');
}

// ── Views ─────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.sh-view').forEach(v => v.hidden = true);
  const el = document.getElementById('view-' + name);
  if (el) el.hidden = false;
}

// ── OData ─────────────────────────────────────────────────────
async function odata(method, path, body) {
  const res = await fetch(`/odata/v4/lobby/${path}`, {
    method,
    headers: { Authorization: shell.user.authHeader, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── WebSocket ─────────────────────────────────────────────────
function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/play`);
  ws.onmessage = ({ data }) => {
    const { event, data: payload } = JSON.parse(data);
    if (payload) emitter.emit(event, payload);
  };
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

  // load game UI module
  const mod = await import(`/games/${game}/index.js`);
  shell.game = mod.default;

  // connect WS if needed
  if (!ws || ws.readyState > WebSocket.OPEN) wsConnect();

  // wait for open, then join
  const join = () => wsSend('join', { room: roomId });
  ws.readyState === WebSocket.OPEN ? join() : (ws.onopen = join);

  // once joined — platform sets me, then mounts game
  emitter.on('joined', function onFirstJoin(payload) {
    if (payload.player !== shell.user.id) return;
    emitter.off('joined', onFirstJoin);

    shell.me = { user: shell.user.id, symbol: payload.symbol, isHost: payload.host };

    // build sdk and hand full control to game
    const sdk = makeSdk({
      room: shell.room,
      me:   shell.me,
      wsSend,
      emitter,
      toastFn: toast,
      leaveFn: leaveRoom,
    });

    showView('room');
    const rootEl = $('game-root');
    rootEl.innerHTML = '';
    shell.unmount = shell.game.mount(rootEl, sdk) ?? null;
  });
}

async function createRoom(game) {
  const { value: roomId } = await odata('POST', 'createRoom', { game });
  await joinRoom(roomId);  // joinRoom will fetch code+game since they're not passed
}

function leaveRoom() {
  if (shell.room) wsSend('leave', { room: shell.room.id });
  shell.unmount?.();
  shell.unmount = null;
  shell.room = null;
  shell.me   = null;
  shell.game = null;
  emitter.clear();
  $('sh-room-id').hidden = true;
  $('sh-btn-copy').hidden = true;
  showView('lobby');
  loadLobby();
}

// ── Kick route — shell handles because game may not listen ────
emitter.on('playerKicked', ({ player }) => {
  if (player === shell.user?.id) { toast('You were kicked'); leaveRoom(); }
});

// ── Lobby ─────────────────────────────────────────────────────
async function loadLobby() {
  const data = await odata('GET', 'Games').catch(() => ({ value: [] }));
  const list = $('sh-game-list');
  list.innerHTML = (data.value ?? []).map(g => `
    <li>
      <strong>${g.name}</strong>
      <span class="sh-small">${g.minPlayers}–${g.maxPlayers} players</span>
      <button class="sh-small" data-game="${g.id}">Create room</button>
    </li>`).join('');
  list.querySelectorAll('[data-game]').forEach(b =>
    b.onclick = () => createRoom(b.dataset.game));
}

// ── Boot ──────────────────────────────────────────────────────
function renderLoginView() {
  const ul = $('sh-user-list');
  ul.innerHTML = USERS.map(u =>
    `<button class="sh-user-btn" data-user="${u}">${u}</button>`).join('');
  ul.querySelectorAll('[data-user]').forEach(b =>
    b.onclick = () => {
      login(b.dataset.user);
      $('sh-who').textContent = b.dataset.user;
      showView('lobby');
      loadLobby();
    });
}

$('sh-btn-logout').onclick = logout;
$('sh-btn-leave').onclick  = leaveRoom;
$('sh-btn-copy').onclick   = () => {
  navigator.clipboard.writeText(shell.room?.code ?? '');
  toast('Room code copied');
};
$('sh-join-input').onkeydown = e => { if (e.key === 'Enter') $('sh-btn-join').click(); };
$('sh-btn-join').onclick = () => {
  const id = $('sh-join-input').value.trim();
  if (id) joinByCode(id);
};

renderLoginView();
const saved = sessionStorage.getItem('user');
if (saved) { login(saved); $('sh-who').textContent = saved; showView('lobby'); loadLobby(); }
else showView('login');
