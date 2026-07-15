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
| `app/router/` | Approuter config (`xs-app.json`, `default-env.json`) |
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

### Game Interface Contract

```js
module.exports = {
  // Required
  meta: { name, minPlayers, maxPlayers },
  settingsSchema: { key: { type, values?, default } },
  init(settings)                  // → initial state object
  applyMove(state, move, symbol)  // → { state, end: null } | { state, end: { winner } } | { error }

  // Optional
  score(end, players)             // → [{ user, result: 'win'|'loss'|'draw', points }]
                                  //   omit to use platform default: W:3 D:1 L:0
  extendService(srv)              // → register extra actions/events on PlayService
};
```

### Adding a Game (3 files)

```
games/mygame/
  package.json     { "name": "@cap-games/mygame" }
  cds-plugin.js    (cds.env.games ??= {}).mygame = require('./game')
  game.js          exports the interface above
```

Activate: `npm add @cap-games/mygame -w .` (or add to root `package.json` dependencies directly).

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
- UI: kick button in host controls
