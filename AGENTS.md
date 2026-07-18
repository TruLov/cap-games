# AGENTS.md — cap-games Architecture

Multiplayer browser game platform on SAP BTP, built with CAP Node.js.
The platform handles all generic concerns (lobby, host, auth, leaderboard).
Games are self-registering plugin packages — adding a game never touches platform code.

---

## Request Flow

```
Browser
  │  HTTPS (REST)          HTTPS + WSS (WebSocket)
  ▼
Approuter (IAS auth, websockets.enabled: true)
  │  forwards Bearer token
  ▼
CAP Server (Node.js)
  ├─ LobbyService   /odata/v4/lobby   — browse games, create rooms, leaderboard
  └─ PlayService    /ws/play          — join, play, chat, host controls (realtime)
        │
        ├─ engine.js    transient board state + grace timers
        └─ registry.js  cds.env.games → loaded game plugins
```

**Two protocols, one reason:** Room setup (browse catalogue, create room) uses standard OData/REST — no WebSocket needed. Gameplay and chat use WebSocket for bidirectional realtime events.

---

## Project Structure

| Path | Purpose |
|---|---|
| `db/schema.cds` | Persistent entities: Rooms, Players, Matches, Leaderboard |
| `srv/lobby-service.cds/.js` | OData service — game catalogue, rooms, leaderboard, createRoom |
| `srv/play-service.cds/.js` | WebSocket service — all realtime actions + events |
| `srv/engine.js` | Transient board state, reconnect grace timers, default scoring |
| `srv/registry.js` | Reads `cds.env.games` populated by game plugins at startup |
| `app/` | Shell: login, lobby, header/nav. Static files served by CAP. |
| `app/sdk.js` | SDK factory — `makeSdk()` + `makeEmitter()` |
| `app/shell/` | Importable UI components: `chat.js`, `players.js`, `host.js` |
| `games/<name>/` | Game plugin packages (npm workspaces) |

---

## Platform vs. Game

| Generic (Platform — never touch when adding a game) | Game-specific (Plugin) |
|---|---|
| Lobby, rooms, host management | Win condition |
| Settings mechanics (not content) | Settings schema |
| Join, kick, leave, reconnect | Board / state structure |
| Chat broadcast | Min/max players |
| Status machine (lobby → playing → finished) | Move validation |
| Leaderboard persistence | Optional: custom scoring |
| Auth (IAS), DB, WebSocket transport | Optional: extra actions/events |

**State split:**
- **Persistent (DB):** Rooms, Players, Matches, Leaderboard — survives restarts, never inconsistent
- **Transient (In-Memory):** Live board state, grace timers — intentionally lost on restart; stats are safe because they are written atomically on `finished`

---

## Status Machine

```
         join + start
lobby ────────────────► playing ───── win/draw ──► finished
  ▲                       │  ▲                         │
  │ backToLobby           │  │ reconnect (60s grace)   │ rematch
  │                       ▼  │                         │
  └──── backToLobby ── paused │                         ▼
                    (disconnect)               playing (rematch)
```

Status is persisted in `Rooms.status`. Board state is transient (`engine.js`).
After a server restart, `playing`/`paused` rooms stay in DB but have no board state — players rejoin and the host can `backToLobby` or `rematch`.

---

## Extension Concept: Game Plugins

Games self-register via CAP's `cds-plugin.js` mechanism.
CAP auto-loads `cds-plugin.js` from every installed package in `node_modules/`.

```
npm install
      │
      ▼
CAP runtime scans node_modules/*/cds-plugin.js
      │
      ▼
@cap-games/tictactoe/cds-plugin.js runs:
  (cds.env.games ??= {}).tictactoe = require('./game')
      │
      ▼
registry.js reads cds.env.games
      │
      ├─ LobbyService: exposes game in /Games catalogue
      └─ PlayService:  dispatches move → game.applyMove()
                       calls game.score() on finished
                       calls game.extendService() on served
```

No change to platform code. No registry file to edit. Install → works.

### UI Architecture: Shell + SDK + Game

The shell owns login/lobby/header. Once a room is joined, the game owns its entire UI area.

```
Shell (thin)                         Game UI
─────────────────────────────────    ────────────────────────────────────
Header/Nav (always)                  mount(rootEl, sdk)
Login + Lobby                          ├─ build own layout freely
WS transport + reconnect               ├─ sdk.on('moved', redraw)
Room lifecycle (join/leave)            ├─ sdk.send('move', payload)
                                       └─ optional: import shell components
                                            import { mountChat }    from '/shell/chat.js'
                                            import { mountPlayers } from '/shell/players.js'
                                            import { mountHostControls } from '/shell/host.js'
```

**SDK object** passed to `mount(rootEl, sdk)`:
```js
sdk = {
  room,                    // { id, game }
  me,                      // { user, symbol, isHost }
  send(action, data),      // any WS action → PlayService (not just 'move')
  on(event, fn),           // subscribe to any server event
  off(event, fn),          // unsubscribe (call in unmount cleanup)
  toast(msg),              // brief status in shell header
  leave(),                 // leave room
}
```

Shell components (`/shell/*.js`) are **optional** — game imports and places them where it wants, or skips them entirely. Each returns a cleanup function.

### Game Interface Contract

**State rules (required by engine):**
- `state.turn` must be a symbol string — engine reads it to track whose move it is
- `end.winner` must be a symbol (`'X'`, `'O'`, …) or `'draw'`
- Symbols assigned by platform: `'X'`, `'O'`, `'A'`, … — spectators get `'spectator'`

```js
module.exports = {
  // Required
  meta: { name, minPlayers, maxPlayers },
  settingsSchema: { key: { type, values?, default } },
  init(settings)                  // → { turn: 'X', /* your state */ }
  applyMove(state, move, symbol)  // → { state, end: null } | { state, end: { winner } } | { error }

  // Optional
  score(end, players)             // → [{ user, result: 'win'|'loss'|'draw', points }]
                                  //   omit to use platform default: W:3 D:1 L:0
  extendService(srv)              // → register extra actions/events on PlayService

  // Optional — hidden information (secret hands, face-down cards, roles)
  publicState(state)              // → redacted state broadcast to everyone in the room
  privateState(state, symbol)     // → per-player slice, delivered ONLY to that user
};
```

### Hidden Information (state projection)

By default the platform broadcasts the full `state` to the whole room — fine for
perfect-information games (TicTacToe). Games with secrets must **not** leak them
over the wire. If a game defines **both** `publicState` and `privateState`, the
platform redacts automatically:

- The room-scoped events (`started`/`moved`/`finished`/`rematched`) carry only
  `publicState(state)`.
- Each player additionally receives a `privateState` event — delivered to that
  user alone via the WebSocket `user` filter — carrying `privateState(state, symbol)`.
- On join/reconnect the platform sends the (re)joining user a private snapshot so
  they can render immediately.

Define neither hook → legacy behaviour (full state broadcast), unchanged.
This is a generic platform capability; game logic stays in `games/<name>/`.

### Adding a Game (4 files)

Use `games/tictactoe/` as reference — copy and adapt.

```
games/mygame/
  package.json     { "name": "@cap-games/mygame", "version": "1.0.0", "main": "game.js" }
  cds-plugin.js    (cds.env.games ??= {}).mygame = require('./game')
                   + cds.on('bootstrap', app => app.use('/games/mygame', express.static(...)))
  game.js          backend — exports the interface above
  ui/index.js      frontend — exports default { mount(rootEl, sdk) }
```

**`ui/index.js`** is served automatically at `/games/<name>/index.js` by the game's own `cds-plugin.js` bootstrap hook. The platform shell (`app/platform.js`) dynamically imports it and calls `mount()` once when the room starts.

Game UI contract:
```js
export default {
  mount(rootEl, sdk) {
    // build your full game UI into rootEl — layout, board, anything
    // sdk.on('started'/'moved'/'finished', handler) — subscribe to events
    // sdk.send('move', payload) — send moves (payload must match applyMove)
    // optional: import + use shell components
    return () => { /* cleanup: sdk.off, remove listeners */ };
  }
};
```

Activate: add `"@cap-games/mygame": "*"` to root `package.json` dependencies, then `npm install`.

---

## Data Model

| Entity | Purpose |
|---|---|
| `Rooms` | Active rooms — game type, host, status, settings (JSON) |
| `Players` | Players per room — user id, symbol (X/O/…), isHost |
| `Matches` | Completed match history — winner, player snapshot, final state |
| `Leaderboard` | Aggregated stats per user+game — wins, losses, draws, points |

`Rooms` and `Players` are cleaned up automatically when a room empties.
`Matches` and `Leaderboard` are permanent.

---

## Conventions

- **CAP 10** — handlers use `class extends cds.ApplicationService { async init() }`
- **CQL global API** — `SELECT/INSERT/UPDATE/DELETE` used directly (no `cds.db.run`)
- **No state in service closures** — board state lives in `engine.js` module-level Map, never in handler closures
- **Games are pure logic** — no CAP imports, no DB access; only `init`/`applyMove`/`score`
- **Never modify `srv/` for a new game** — only `games/<name>/` and a dependency line

## TODO

- Short room join codes (4-char) instead of UUIDs — friendlier sharing
- Team-play support (multiple players per symbol)
- `cds.test` test suite to replace ad-hoc Node scripts
- UI: initial player list sync when joining an existing room
