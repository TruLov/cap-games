# cap-games

Multiplayer browser game platform on SAP BTP — built with CAP Node.js.
Games are plugin packages. Add a game: 3 files, one dependency line, done.

**Included:** TicTacToe

---

## Architecture

```
Browser (Lobby: REST / Gameplay: WebSocket)
     │
Approuter (IAS auth, websockets.enabled)
     │
CAP Server (app/)
  ├─ LobbyService  (OData /odata/v4/lobby)   — browse games, create rooms, leaderboard
  └─ PlayService   (WebSocket /ws/play)       — join, play, chat, host controls

platform/
  ├─ db/schema.cds      Rooms, Players, Matches, Leaderboard
  ├─ srv/engine.js      transient board state, reconnect grace, scoring
  ├─ srv/registry.js    game plugin registry (reads cds.env.games)
  ├─ lobby-service.*    OData service
  └─ play-service.*     WebSocket service

games/tictactoe/        @cap-games/tictactoe plugin
  ├─ cds-plugin.js      self-registers via cds.env.games (auto-loaded by CAP)
  └─ game.js            game logic only (init / applyMove / score)
```

Room isolation via `@ws.context` — plugin broadcasts events only to clients in the same room.
Persistent state: Rooms, Players, Matches, Leaderboard in SQLite (dev) / HANA (prod).
Transient: live board state, chat (not persisted — intentional).

---

## Local Development

```sh
npm install
cds watch app
```

- LobbyService: `http://localhost:4004/odata/v4/lobby`
- PlayService:  `ws://localhost:4004/ws/play`
- Auth: `mocked` locally. Users: `alice`, `bob`, `carol`

### Tools

```sh
# websocat for WebSocket testing
nix shell nixpkgs#websocat       # or add to environment.systemPackages
```

---

## Quick Game (copy-paste)

**Step 1 — Create room (HTTP/REST, alice is host+X):**
```sh
curl -X POST http://localhost:4004/odata/v4/lobby/createRoom \
  -H "Authorization: Basic YWxpY2U6YWxpY2U=" \
  -H "Content-Type: application/json" \
  -d '{"game":"tictactoe"}'
# → {"value":"<roomId>"}
```

**Step 2 — Terminal A (alice = X):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic YWxpY2U6YWxpY2U" ws://localhost:4004/ws/play
```
```
{"event":"join","data":{"room":"<roomId>"}}
{"event":"start","data":{"room":"<roomId>"}}
```

**Step 3 — Terminal B (bob = O):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic Ym9iOmJvYg==" ws://localhost:4004/ws/play
```
```
{"event":"join","data":{"room":"<roomId>"}}
```

**Step 4 — Play (alice X first, alternating):**
```
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":0}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":1}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":4}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":2}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":8}"}}
```
→ `finished` winner: X

**Board layout:**
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

**After game (host only):**
```
{"event":"rematch","data":{"room":"<roomId>"}}
{"event":"backToLobby","data":{"room":"<roomId>"}}
```

---

## Lobby REST API

`GET /odata/v4/lobby/Games` — game catalogue
`GET /odata/v4/lobby/Rooms` — active rooms
`GET /odata/v4/lobby/Leaderboard` — leaderboard
`POST /odata/v4/lobby/createRoom` body: `{"game":"tictactoe"}` → roomId

Auth header: `Authorization: Basic <base64(user:user)>` (dev mocked)

---

## WebSocket Actions (PlayService)

| Action | Who | Status | Effect |
|--------|-----|--------|--------|
| `join(room)` | anyone | any | Join room; creator (via createRoom) is host+X |
| `configure(room, settings)` | host | lobby | Set game settings (JSON string) |
| `start(room)` | host | lobby | → playing |
| `move(room, data)` | X/O | playing | Game move (JSON string, game-specific) |
| `rematch(room)` | host | finished | → playing, keep players |
| `backToLobby(room)` | host | any | → lobby, all notified |
| `kick(room, user)` | host | any | Remove player/spectator |
| `leave(room)` | anyone | any | Leave voluntarily |
| `chat(room, text)` | anyone | any | Broadcast chat message (transient) |

## WebSocket Events

| Event | Key payload |
|-------|-------------|
| `joined` | `{ room, player, symbol, host, status }` |
| `configured` | `{ room, settings }` |
| `started` | `{ room, firstTurn }` |
| `moved` | `{ room, data }` — JSON game state |
| `finished` | `{ room, winner, state }` |
| `rematched` | `{ room, firstTurn }` |
| `lobbyReset` | `{ room }` |
| `playerLeft` | `{ room, player, symbol, newHost }` |
| `playerKicked` | `{ room, player }` |
| `playerDisconnected` | `{ room, player, symbol }` |
| `playerReconnected` | `{ room, player, symbol }` |
| `chatMessage` | `{ room, player, text, ts }` |
| `gameError` | `{ room, message }` |

## Reconnect

Disconnect during `playing` → room paused (60s grace).
Reconnect: `join` same room → `playerReconnected`, game resumes.
Timeout (60s): player removed, host succession, room → lobby.

## Host Succession

Host leaves/disconnects/is kicked → next remaining player becomes host.
Room auto-deleted when all players gone.

---

## Adding a new game (Plugin)

Copy `games/tictactoe/` as a starting point. Four files:

**1. `games/mygame/package.json`**
```json
{
  "name": "@cap-games/mygame",
  "version": "1.0.0",
  "main": "game.js"
}
```

**2. `games/mygame/cds-plugin.js`** — always identical, change name only
```js
const cds = require('@sap/cds');
(cds.env.games ??= {}).mygame = require('./game');
```

**3. `games/mygame/game.js`** — backend logic
```js
module.exports = {
  meta: { name: 'My Game', minPlayers: 2, maxPlayers: 4 },
  settingsSchema: { /* optional */ },

  // state.turn is required — platform reads it to track whose move it is
  init(settings = {}) {
    return { turn: 'X', /* your state */ };
  },

  // symbol = 'X'|'O'|… as assigned by platform; end.winner = symbol | 'draw'
  applyMove(state, move, symbol) {
    // return { error: 'reason' }  on invalid move
    // return { state: newState, end: null }  on valid move
    // return { state: newState, end: { winner: symbol|'draw' } }  on game over
  },

  // optional — omit to use platform default W:3 D:1 L:0
  score(end, players) { /* → [{ user, result, points }] */ },

  // optional — register extra WS actions/events on PlayService
  extendService(srv) { /* srv.on('myAction', req => { ... }) */ },
};
```

**4. `games/mygame/ui/board.js`** — frontend (ES module, required for playability)
```js
export default {
  // called by platform after every state change
  // draw your UI into el; call onMove(payload) on player input
  // payload must match what applyMove() expects as the move argument
  render(state, el, { onMove, mySymbol }) { }
};
```
Served automatically at `/games/mygame/board.js` via `server.js` bootstrap hook.

**Activate:** add `"@cap-games/mygame": "*"` to root `package.json` dependencies, then `npm install`.

The platform provides: lobby, host, join, kick, settings, chat, reconnect, status machine, leaderboard — automatically. Your game only implements the rules and the board UI.

---

## Debug Logging

```sh
CDS_LOG_LEVELS_game=info cds watch   # game events (default on)
DEBUG=websocket cds watch            # WS transport: connect/disconnect
```

---

## Deploy to BTP (Cloud Foundry Trial)

```sh
mbt build
cf deploy mta_archives/cap-games_1.0.0.mtar
```

Creates:
- `cap-games-srv` — CAP server
- `cap-games` — Approuter (IAS auth)
- `cap-games-ias` — IAS identity service
- `cap-games-hana` — HANA HDI container

**Post-deploy — IAS Self-Registration:**
1. BTP Cockpit → Services → Instances → `cap-games-ias` → open IAS Admin Console
2. Applications → `cap-games` → Authentication & Access
3. Enable **Self-Registration** → Save

**Connect (deployed):**
```sh
cf app cap-games   # get approuter URL
# REST: https://<approuter-url>/odata/v4/lobby/Games
# WS:   wss://<approuter-url>/ws/play  (after IAS login for session cookie)
```

---

## base64 reference (local mocked auth)

| Header type | User | Value |
|---|---|---|
| `Authorization: Basic <value>` | alice | `YWxpY2U6YWxpY2U=` |
| `Authorization: Basic <value>` | bob | `Ym9iOmJvYg==` |
| `Authorization: Basic <value>` | carol | `Y2Fyb2w6Y2Fyb2w=` |
| `Cookie: X-Authorization=Basic <value>` | alice | `YWxpY2U6YWxpY2U` |
| `Cookie: X-Authorization=Basic <value>` | bob | `Ym9iOmJvYg==` |

HTTP (OData): use `Authorization` header.
WebSocket (websocat): use `Cookie: X-Authorization=Basic ...` header.

---

## TODO (later)

- Short join codes (4-char) instead of UUIDs — friendlier room sharing
- Team-play support (multiple players per symbol/side)
