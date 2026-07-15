/**
 * platform.js — CAP Games Platform Shell
 *
 * Responsibilities:
 *   - User selection (mocked auth via X-Authorization cookie + fetch header)
 *   - OData calls to LobbyService
 *   - WebSocket connection to PlayService
 *   - Dynamic game board import from /games/<name>/board.js
 *   - Event routing → board re-render
 */

// ── State ────────────────────────────────────────────────────
const state = {
  user: null,           // { id, authHeader }
  room: null,           // { id, game }
  mySymbol: null,
  isHost: false,
  roomStatus: 'lobby',
  players: [],
  board: null,          // loaded board module
};

let ws = null;

const USERS = ['alice', 'bob', 'carol', 'dave', 'erin'];

// ── DOM helpers ───────────────────────────────────────────────
const $  = id => document.getElementById(id);
const show  = id => $(id).classList.remove('hidden');
const hide  = id => $(id).classList.add('hidden');
const setView = name => {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  show('view-' + name);
};

// ── Auth (mocked local) ───────────────────────────────────────
function login(userId) {
  const b64 = btoa(`${userId}:${userId}`);
  document.cookie = `X-Authorization=Basic ${b64}; path=/`;
  state.user = { id: userId, authHeader: `Basic ${b64}` };
  sessionStorage.setItem('user', userId);
}

function logout() {
  document.cookie = 'X-Authorization=; path=/; max-age=0';
  sessionStorage.removeItem('user');
  state.user = null;
  if (ws) { ws.close(); ws = null; }
  setView('login');
}

// ── OData helpers ─────────────────────────────────────────────
async function odata(method, path, body) {
  const res = await fetch(`/odata/v4/lobby/${path}`, {
    method,
    headers: {
      'Authorization': state.user.authHeader,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── WebSocket ─────────────────────────────────────────────────
function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws/play`);
  ws.onmessage = e => handleEvent(JSON.parse(e.data));
  ws.onerror   = () => setStatus('room', 'Connection error');
}

function wsSend(event, data) {
  if (ws?.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ event, data }));
}

// ── Event routing ─────────────────────────────────────────────
function handleEvent({ event, data }) {
  if (!data) return;
  switch (event) {
    case 'joined':           onJoined(data);          break;
    case 'started':          onStarted(data);         break;
    case 'moved':            onMoved(data);           break;
    case 'finished':         onFinished(data);        break;
    case 'rematched':        onRematched(data);       break;
    case 'lobbyReset':       onLobbyReset(data);      break;
    case 'playerLeft':       onPlayerLeft(data);      break;
    case 'playerKicked':     onPlayerKicked(data);    break;
    case 'playerDisconnected': onDisconnected(data);  break;
    case 'playerReconnected':  onReconnected(data);   break;
    case 'chatMessage':      onChat(data);            break;
    case 'gameError':        setStatus('room', `⚠ ${data.message}`); break;
  }
}

function onJoined({ room, player, symbol, host, status }) {
  if (player === state.user.id) {
    state.mySymbol  = symbol;
    state.isHost    = host;
    state.roomStatus = status;
    setView('room');
    $('room-title').textContent = state.room.game;
    $('room-id-display').textContent = room;
    setStatus('room', symbol === 'spectator'
      ? 'You are spectating'
      : `You are ${symbol}${host ? ' (host)' : ''} — waiting for players…`);
  }
  addPlayer({ player, symbol, host: symbol === state.players.find(p=>p.player===player)?.host });
  updateControls();
}

function onStarted({ firstTurn }) {
  state.roomStatus = 'playing';
  setStatus('room', `Playing — ${firstTurn} goes first`);
  updateControls();
}

function onMoved({ data }) {
  const s = JSON.parse(data);
  renderBoard(s);
  setStatus('room', `Turn: ${s.turn}`);
}

function onFinished({ winner, state: stateJson }) {
  state.roomStatus = 'finished';
  const s = JSON.parse(stateJson);
  renderBoard(s);
  const msg = winner === 'draw' ? 'Draw!' : `${winner} wins!`;
  setStatus('room', `Game over — ${msg}`);
  updateControls();
}

function onRematched({ firstTurn }) {
  state.roomStatus = 'playing';
  $('board-container').innerHTML = '';
  setStatus('room', `Rematch — ${firstTurn} goes first`);
  updateControls();
}

function onLobbyReset() {
  state.roomStatus = 'lobby';
  $('board-container').innerHTML = '';
  setStatus('room', 'Back in lobby');
  updateControls();
}

function onPlayerLeft({ player, newHost }) {
  removePlayer(player);
  if (newHost && newHost === state.user.id) {
    state.isHost = true;
    setStatus('room', 'You are now host');
  }
  updateControls();
}

function onPlayerKicked({ player }) {
  if (player === state.user.id) {
    setStatus('lobby', 'You were kicked');
    leaveRoom();
    return;
  }
  removePlayer(player);
  updateControls();
}

function onDisconnected({ player, symbol }) {
  setStatus('room', `${player} (${symbol}) disconnected — waiting 60s…`);
}

function onReconnected({ player, symbol }) {
  state.roomStatus = 'playing';
  setStatus('room', `${player} (${symbol}) reconnected`);
  updateControls();
}

function onChat({ player, text }) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.innerHTML = `<strong>${player}:</strong> ${text}`;
  $('chat-messages').appendChild(el);
  $('chat-messages').scrollTop = 9999;
}

// ── Board ─────────────────────────────────────────────────────
async function loadBoard(game) {
  if (state.board) return;
  const mod = await import(`/games/${game}/board.js`);
  state.board = mod.default;
}

function renderBoard(gameState) {
  if (!state.board) return;
  state.board.render(gameState, $('board-container'), {
    mySymbol: state.mySymbol,
    onMove: move => wsSend('move', { room: state.room.id, data: JSON.stringify(move) }),
  });
}

// ── Player list ───────────────────────────────────────────────
function addPlayer({ player, symbol }) {
  if (state.players.find(p => p.player === player)) return;
  state.players.push({ player, symbol });
  renderPlayers();
}

function removePlayer(player) {
  state.players = state.players.filter(p => p.player !== player);
  renderPlayers();
}

function renderPlayers() {
  $('player-list').innerHTML = state.players
    .map(p => `<li>${p.player} <span class="sym">${p.symbol}</span>${p.player === state.user.id ? ' (you)' : ''}</li>`)
    .join('');
}

// ── Controls visibility ───────────────────────────────────────
function updateControls() {
  const s = state.roomStatus;
  state.isHost && s === 'lobby'    ? show('host-controls')    : hide('host-controls');
  state.isHost && s === 'finished' ? show('post-game-controls') : hide('post-game-controls');
}

function setStatus(view, msg) {
  $(`${view}-status`).textContent = msg;
}

// ── Room management ───────────────────────────────────────────
async function joinRoom(roomId) {
  setView('room');
  $('room-id-display').textContent = roomId;   // show immediately
  state.room    = { id: roomId };
  state.players = [];
  $('player-list').innerHTML   = '';
  $('chat-messages').innerHTML = '';
  $('board-container').innerHTML = '';
  state.board = null;

  // fetch game type from lobby
  const data = await odata('GET', `Rooms?$filter=ID eq '${roomId}'`).catch(() => null);
  const game = data?.value?.[0]?.game ?? 'tictactoe';
  state.room.game = game;

  await loadBoard(game);
  if (!ws || ws.readyState !== WebSocket.OPEN) wsConnect();
  // wait briefly for connection, then join
  const ready = () => wsSend('join', { room: roomId });
  ws.readyState === WebSocket.OPEN ? ready() : (ws.onopen = ready);
}

async function createRoom(game) {
  const data = await odata('POST', 'createRoom', { game });
  const roomId = data.value;
  setStatus('lobby', `Room created: ${roomId}`);
  await joinRoom(roomId);
}

function leaveRoom() {
  if (state.room) wsSend('leave', { room: state.room.id });
  state.room = null; state.players = [];
  state.mySymbol = null; state.isHost = false;
  setView('lobby');
  loadLobby();
}

// ── Lobby ─────────────────────────────────────────────────────
async function loadLobby() {
  try {
    const data = await odata('GET', 'Games');
    $('game-list').innerHTML = (data.value ?? [])
      .map(g => `<li>
        <strong>${g.name}</strong>
        <span class="small">${g.minPlayers}–${g.maxPlayers} players</span>
        <button class="small" data-game="${g.id}">Create room</button>
      </li>`).join('');
    $('game-list').querySelectorAll('[data-game]').forEach(b =>
      b.onclick = () => createRoom(b.dataset.game));
  } catch (e) {
    setStatus('lobby', 'Could not load games');
  }
}

// ── Boot ──────────────────────────────────────────────────────
function renderLoginView() {
  $('user-list').innerHTML = USERS.map(u =>
    `<button class="user-btn" data-user="${u}">${u}</button>`).join('');
  $('user-list').querySelectorAll('[data-user]').forEach(b =>
    b.onclick = () => {
      login(b.dataset.user);
      $('lobby-user').textContent = b.dataset.user;
      setView('lobby');
      loadLobby();
    });
}

// wire static buttons
$('btn-logout').onclick    = logout;
$('btn-leave').onclick     = leaveRoom;
$('btn-join').onclick      = () => joinRoom($('join-room-id').value.trim());
$('btn-start').onclick     = () => wsSend('start',      { room: state.room.id });
$('btn-rematch').onclick   = () => wsSend('rematch',    { room: state.room.id });
$('btn-back-lobby').onclick= () => wsSend('backToLobby',{ room: state.room.id });
$('btn-chat').onclick      = () => {
  const t = $('chat-input').value.trim();
  if (!t) return;
  wsSend('chat', { room: state.room.id, text: t });
  $('chat-input').value = '';
};
$('chat-input').onkeydown   = e => { if (e.key === 'Enter') $('btn-chat').click(); };
$('join-room-id').onkeydown = e => { if (e.key === 'Enter') $('btn-join').click(); };

// restore session
renderLoginView();
const saved = sessionStorage.getItem('user');
if (saved) {
  login(saved);
  $('lobby-user').textContent = saved;
  setView('lobby');
  loadLobby();
} else {
  setView('login');
}
