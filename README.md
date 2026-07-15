# cap-games

2-player TicTacToe over WebSocket, built with CAP Node.js.

## Local Development

```sh
npm install
cds watch
```

Server starts at `http://localhost:4004`. GameService exposed at `ws://localhost:4004/ws/game`.

Auth: `mocked` locally (no login needed). Default mock users: `alice` and `bob`.

### Play via websocat

Install: `nix shell nixpkgs#websocat` or add `websocat` to `environment.systemPackages`.

Open **two terminals** — one per player.

**Terminal A — Player 1 (alice = X):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic YWxpY2U6YWxpY2U" ws://localhost:4004/ws/game
```
Then type + Enter:
```
{"event":"join","data":{"room":"r1"}}
```
Response: `"X"`

**Terminal B — Player 2 (bob = O):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic Ym9iOmJvYg==" ws://localhost:4004/ws/game
```
Then:
```
{"event":"join","data":{"room":"r1"}}
```
Response: `"O"`

### Board layout
```
 0 | 1 | 2
-----------
 3 | 4 | 5
-----------
 6 | 7 | 8
```

X always goes first. Take turns sending moves:
```
{"event":"move","data":{"room":"r1","cell":0}}
```

### Events received from server

| Event      | Payload                                         |
|------------|-------------------------------------------------|
| `joined`   | `{ room, player, symbol }`                      |
| `moved`    | `{ room, cell, symbol, board, nextTurn }`       |
| `finished` | `{ room, winner, board }` — winner: X, O, draw |
| `error`    | `{ room, message }`                             |

`board` is a JSON array of 9 cells: `["X",null,"O",...]`

Both terminals receive every event (room broadcast via `@ws.context`).

### Error cases

| Action | Error message |
|---|---|
| Move when it's not your turn | `not your turn` |
| Move to occupied cell | `cell taken` |
| Move after game ended | `no active game` |

### base64 reference

```sh
printf 'alice:alice' | base64   # YWxpY2U6YWxpY2U=
printf 'bob:bob' | base64       # Ym9iOmJvYg==
```

Password is ignored for mock users — only the username matters.

---

## Deploy to BTP (Cloud Foundry Trial)

### Prerequisites
- CF CLI + MBT installed: `npm i -g mbt`
- Logged in: `cf login -a https://api.cf.<region>.hana.ondemand.com`

### Build & Deploy
```sh
mbt build
cf deploy mta_archives/cap-games_1.0.0.mtar
```

This creates:
- `cap-games-srv` — CAP Node.js backend
- `cap-games` — Approuter with IAS auth
- `cap-games-ias` — IAS identity service instance

### Post-Deploy: IAS Self-Registration

1. Open **SAP BTP Cockpit → Services → Instances** → find `cap-games-ias` → open IAS Admin Console
2. **Applications** → find `cap-games` → **Authentication & Access**
3. Enable **Self-Registration** → Save

Users can now register themselves at the Approuter login page.

### Connect via WebSocket (deployed)

```sh
# Get approuter URL:
cf app cap-games

# Connect with IAS session cookie (log in via browser first, then copy cookie)
websocat -t -H="Cookie: <session-cookie>" wss://<approuter-url>/ws/game
```

Open `https://<approuter-url>` in browser to trigger IAS login, then copy the session cookie for websocat.

---

## Architecture

```
websocat / Browser
     │ WSS
     ▼
Approuter (IAS auth, websockets.enabled)
     │ Bearer token forwarded
     ▼
CAP srv  @protocol:'ws' GameService
     │ In-Memory rooms Map
     └─ join  → enter ws.context (room)
     └─ move  → validate + broadcast to room
     └─ leave → exit ws.context (room)
```

Room isolation via `@ws.context` — plugin broadcasts events only to clients in the same room context. No Redis needed (single instance).
