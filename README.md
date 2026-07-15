# cap-games

Multiplayer browser games over WebSocket, built with CAP Node.js.

Currently implemented: **TicTacToe** (2 players).

## Architecture

```
websocat / Browser
     │ WSS
     ▼
Approuter (IAS auth, websockets.enabled)
     │ Bearer token forwarded
     ▼
CAP srv  @protocol:'ws' GameService
     │
     ├─ game-service.js      thin action handlers
     ├─ games/engine.js      generic: host, lobby, reconnect, succession, auto-delete
     └─ games/tictactoe.js   game logic only (init / applyMove)
```

Room isolation via `@ws.context` — plugin broadcasts events only to clients in the same room. No Redis needed (single instance).

## Adding a new game

Create `srv/games/mygame.js` implementing the interface:
```js
module.exports = {
  minPlayers: 2,
  maxPlayers: 4,
  init()                        // → fresh state object
  applyMove(state, move, symbol) // → { state, end: null | { winner } } or { error }
}
```
Register in `game-service.js`:
```js
GAMES['mygame'] = require('./games/mygame');
```
Done. All lobby/host/reconnect/kick logic is handled by the engine.

---

## Local Development

```sh
npm install
cds watch
```

Server: `http://localhost:4004` — GameService at `ws://localhost:4004/ws/game`.

Auth: `mocked` locally. Default users: `alice`, `bob`, `carol`.

### Install websocat

```sh
nix shell nixpkgs#websocat
# or permanently: add websocat to environment.systemPackages
```

---

## Game Flow

```
lobby ──(host: start)──► playing ──(win/draw)──► finished
  ▲                          │                       │
  │ host: backToLobby        │ host: backToLobby     │ host: rematch → playing
  └──────────────────────────┘                       │
  ▲                                                  │
  └──────────────── host: backToLobby ───────────────┘
```

Disconnect during `playing` → `paused` (60s grace). Reconnect via `join` resumes game.

---

## Quick game (copy-paste)

Open **two terminals**.

**Terminal A — alice (becomes X):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic YWxpY2U6YWxpY2U" ws://localhost:4004/ws/game
```

**Terminal B — bob (becomes O):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic Ym9iOmJvYg==" ws://localhost:4004/ws/game
```

Paste line by line, alternating terminals:

**A:** `{"event":"join","data":{"room":"r1","game":"tictactoe"}}`
**B:** `{"event":"join","data":{"room":"r1","game":"tictactoe"}}`
**A (host):** `{"event":"configure","data":{"room":"r1","firstPlayer":"X"}}`
**A (host):** `{"event":"start","data":{"room":"r1"}}`
**A:** `{"event":"move","data":{"room":"r1","data":"{\"cell\":0}"}}`
**B:** `{"event":"move","data":{"room":"r1","data":"{\"cell\":1}"}}`
**A:** `{"event":"move","data":{"room":"r1","data":"{\"cell\":4}"}}`
**B:** `{"event":"move","data":{"room":"r1","data":"{\"cell\":2}"}}`
**A:** `{"event":"move","data":{"room":"r1","data":"{\"cell\":8}"}}`

→ `finished` winner: X

**Rematch:** `{"event":"rematch","data":{"room":"r1"}}`
**Back to lobby:** `{"event":"backToLobby","data":{"room":"r1"}}`

### Board layout (TicTacToe)
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

---

## Actions

| Action | Who | Status | Effect |
|--------|-----|--------|--------|
| `join(room, game?)` | anyone | any | Join room; first player = host |
| `configure(room, firstPlayer)` | host | lobby | Set `firstPlayer`: X / O / random |
| `start(room)` | host | lobby | → playing |
| `move(room, data)` | X / O | playing | Game-specific move (JSON string) |
| `rematch(room)` | host | finished | → playing, keep players |
| `backToLobby(room)` | host | any | → lobby, all clients notified |
| `kick(room, user)` | host | any | Remove player/spectator |
| `leave(room)` | anyone | any | Leave voluntarily |

## Events

| Event | Payload |
|-------|---------|
| `joined` | `{ room, player, symbol, host, status }` |
| `configured` | `{ room, firstPlayer }` |
| `started` | `{ room, firstPlayer }` |
| `moved` | `{ room, data }` — `data` = JSON game state |
| `finished` | `{ room, winner, state }` |
| `rematched` | `{ room }` |
| `lobbyReset` | `{ room }` |
| `playerLeft` | `{ room, player, symbol, newHost }` |
| `playerKicked` | `{ room, player }` |
| `playerDisconnected` | `{ room, player, symbol, remaining }` |
| `playerReconnected` | `{ room, player, symbol }` |
| `gameError` | `{ room, message }` |

## gameError messages

| Message | Cause |
|---------|-------|
| `only host can do this` | Non-host called host-only action |
| `cannot <action> when status is <status>` | Invalid status transition |
| `need N players to start` | Not enough players in lobby |
| `not your turn` | Wrong player moved |
| `invalid cell` | Cell outside 0–8 |
| `cell taken` | Cell already occupied |
| `you are a spectator` | Spectator tried to move |
| `cannot kick yourself` | Host tried to kick themselves |
| `unknown game: <x>` | Unknown game identifier |

## Reconnect

If a player closes their terminal during `playing`:
1. Game → `paused`, both clients get `playerDisconnected`
2. Moves blocked for 60 seconds
3. Reconnect: open new websocat + send `join` with same room → `playerReconnected`, game resumes
4. Timeout (60s): player is removed, host succession applies, room → lobby

## Host succession

When host leaves/disconnects/is kicked: O becomes new host (ruckt auf X slot). If no O: first spectator. If room empty: room deleted automatically.

---

## Debug logging

```sh
CDS_LOG_LEVELS_game=info cds watch    # game events (default)
DEBUG=websocket cds watch             # WS transport: connect/disconnect/upgrade
```

---

## Deploy to BTP (Cloud Foundry Trial)

### Prerequisites
- CF CLI + MBT: `npm i -g mbt`
- Logged in: `cf login -a https://api.cf.<region>.hana.ondemand.com`

### Build & Deploy
```sh
mbt build
cf deploy mta_archives/cap-games_1.0.0.mtar
```

Creates:
- `cap-games-srv` — CAP Node.js backend
- `cap-games` — Approuter with IAS auth
- `cap-games-ias` — IAS identity service instance

### Post-Deploy: IAS Self-Registration

1. BTP Cockpit → Services → Instances → `cap-games-ias` → open IAS Admin Console
2. Applications → `cap-games` → Authentication & Access
3. Enable **Self-Registration** → Save

### Connect (deployed)

```sh
cf app cap-games   # get approuter URL
websocat -t -H="Cookie: <session-cookie>" wss://<approuter-url>/ws/game
```

Open `https://<approuter-url>` in browser to trigger IAS login, then copy session cookie.

---

## base64 reference

```sh
printf 'alice:alice' | base64   # YWxpY2U6YWxpY2U=
printf 'bob:bob'   | base64     # Ym9iOmJvYg==
printf 'carol:carol' | base64   # Y2Fyb2w6Y2Fyb2w=
```

Password is ignored for mock users — only the username matters.
