# AGENTS.md — cap-games Architecture

Multiplayer browser game platform on SAP BTP, built with CAP Node.js.
The platform handles all generic concerns (lobby, host, auth, leaderboard).
Games are self-registering plugin packages — adding a game never touches platform code.

---

## Request Flow

```mermaid
flowchart TB
    Browser["Browser"]
    Approuter["Approuter<br/>IAS auth · websockets.enabled: true<br/>forwards Bearer token"]

    subgraph CAP["CAP Server (Node.js)"]
        Lobby["LobbyService<br/>/odata/v4/lobby<br/>browse games · create rooms · leaderboard"]
        Play["PlayService<br/>/ws/play<br/>join · play · chat · host controls (realtime)"]
        Engine["engine.js<br/>transient board state + grace timers"]
        Registry["registry.js<br/>discoverGames() scans @cap-games/* deps<br/>→ loaded game plugins"]
        Ai["AiService<br/>backend by profile: mock / aicore"]
    end

    Browser -- "HTTPS (REST)" --> Approuter
    Browser -- "HTTPS + WSS (WebSocket)" --> Approuter
    Approuter --> Lobby
    Approuter --> Play
    Play --> Engine
    Play --> Registry
    Registry -. optional .-> Ai
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
| `srv/registry.js` | `discoverGames()` — scans root `package.json` for `@cap-games/*` deps, loads each as a game |
| `srv/server.js` | Custom bootstrap — serves each game's `ui/` at `/games/<id>` |
| `srv/ai-service.cds/.js` | Platform `AiService` — backend (`mock`/`aicore`) picked by profile, connected to via `cds.connect.to('AiService')` |
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

> **"Lobby" is two different things — don't confuse them:**
> - **Platform Lobby** (`view-lobby` in the shell) — the start page: browse games, create/join a room.
> - **Room status `lobby`** — a joined room's *waiting-room* phase (players gathering, host can configure/switch game/set roles, not yet started). Never shown to users as the word "lobby" — UI calls it "waiting for players" / "the room".

```
         join + start
lobby ────────────────► playing ───── win/draw ──► finished
  ▲                       │  ▲                         │
  │ backToRoom            │  │ reconnect (60s grace)   │ rematch
  │                       ▼  │                         │
  └──── backToRoom ── paused │                         ▼
                    (disconnect)               playing (rematch)
```

Status is persisted in `Rooms.status`. Board state is transient (`engine.js`).
After a server restart, `playing`/`paused` rooms stay in DB but have no board state — players rejoin and the host can `backToRoom` or `rematch`.

While a room is in status `lobby` (waiting room), the host may also:
- `switchGame(room, game)` — change the room's game before it starts; resets settings, re-splits existing players into player/spectator against the new game's `maxPlayers` (host first, then original join order), emits `gameSwitched` (platform swaps the mounted game UI automatically — no per-game code needed) and `roleChanged` for anyone bumped to spectator.
- `setRole(room, user, spectator)` — promote a spectator to player or demote a player to spectator (capped by `maxPlayers`); emits `roleChanged`.

---

## Extension Concept: Game Plugins

Games register **declaratively** — the same pattern official CAP plugins
(@cap-js/sqlite, @cap-js/ai, …) use: all wiring lives in the plugin's
`package.json` `cds` section; `cds-plugin.js` is an **empty marker file**
(CAP only merges the `cds` section of packages that have one).

```
npm install
      │
      ▼
Games are discovered by convention: every @cap-games/* dependency is a game
(id = name after the scope). No "cds.games" config needed.
      │
      ├─ srv/server.js (bootstrap): serves @cap-games/<id>/app at /games/<id>
      └─ srv/registry.js (served):  discoverGames() → imports each → validates contract
             │
             ├─ LobbyService: exposes game in /Games catalogue
             └─ PlayService:  dispatches move → game.applyMove()
                              calls game.score() on finished
                              calls game.extendService() on served
```

No change to platform code. No registry file to edit. Install → works.
(Programmatic registration of a ready module object in `cds.env.games`
still works for backwards compatibility.)

### Optional: plugin-owned persistence + service

A game may bring its own CDS model — entities and an own (OData) service,
"an own CAP app inside the plugin" — with one more `cds` line:

```json
"requires": { "mygame": { "model": "@cap-games/mygame/srv/service.cds" } }
```

CAP includes every `requires.*.model` in the effective model: entities are
deployed (SQLite/Postgres) alongside the platform schema, the service is served
with its sibling `service.js` impl. Reference: `games/kaffee-kwest/`
(scenarios, player chronicles + `KaffeeKwestService` at `/odata/v4/kaffee-kwest`).
Keep async work (AI calls, cross-room persistence) in such a service —
never in `applyMove`, which stays pure and synchronous.

### UI Architecture: Shell + SDK + Game

The shell owns login/lobby/header, AND the entire room chrome — players list,
chat, and host controls (switch-game, start, rematch, back-to-room) — for the
room's whole lifetime. A game module is only ever mounted once a match is
actually starting/active; it never renders any pre-start "lobby" UI and never
tracks its own roster.

```
Shell (owns the room)                        Game UI
──────────────────────────────────────       ──────────────────────────────────
Header/Nav, Login + Lobby                    renderSettings(el, sdk)  [optional]
WS transport + auto-reconnect                  ├─ host-only pre-start config
Room lifecycle (join/leave)                    │  (e.g. a menu preset) — shown
Persistent players + chat (whole session)      │  in the platform's waiting room
Waiting room (status 'lobby'):                 └─ takes over the Start trigger
  switch-game, Start (generic or the              itself if it needs to e.g.
  game's own via renderSettings)                  configure() before start()
Match controls (Rematch/Back to room,
  shown whenever status is 'finished')        mount(rootEl, sdk)
sdk.players — live roster, canonical,          ├─ called ONLY once the match is
  kept correct for the whole room session          starting/active (or you're
                                                    reconnecting into one)
                                                ├─ renders gameplay ONLY — board,
                                                │  hand, log, whatever your game needs
                                                ├─ sdk.on('moved', redraw)
                                                ├─ sdk.send('move', payload)
                                                └─ torn down on backToRoom/switchGame
```

**SDK object** passed to `renderSettings(el, sdk)` and `mount(rootEl, sdk)`:
```js
sdk = {
  room,                    // { id, game }
  me,                      // { user, spectator, isHost }
  players,                 // live roster [{ user, spectator, isHost }] — the
                           // platform keeps this current for the room's whole
                           // lifetime; read it directly, never track your own copy
  send(action, data),      // any WS action → PlayService (not just 'move')
  on(event, fn),           // subscribe to any server event
  off(event, fn),          // unsubscribe (call in unmount cleanup)
  toast(msg),              // brief status in shell header
  leave(),                 // leave room
}
```

Shell components (`/shell/*.js`) are platform-internal — mounted once by
`platform.js` for the room's whole session. Games never import them directly.

### Game Interface Contract

**State rules (required by engine):**
- Players are identified by their `user` id — the platform assigns **no** symbols.
  A game that wants marks (e.g. tic-tac-toe's X/O) derives them itself from the
  ordered `players` roster in `init`.
- `state.turn` must be a `user` id — engine reads it to track whose move it is
- `end.winner` must be a `user` id or `'draw'`
- Player vs spectator is a platform concern (`Players.spectator` flag); the game
  only ever receives players in its roster and via `applyMove`.

```js
module.exports = {
  // Required
  meta: { name, minPlayers, maxPlayers },
  settingsSchema: { key: { type, values?, default } },
  init(settings, players)         // players: ordered [{ user, isHost }]
                                  // → { turn: players[0].user, /* your state */ }
  applyMove(state, move, user)    // → { state, end: null } | { state, end: { winner } } | { error }

  // Optional
  score(end, players)             // → [{ user, result: 'win'|'loss'|'draw', points }]
                                  //   omit to use platform default: W:3 D:1 L:0
  extendService(srv)              // → register extra actions/events on PlayService

  // Optional — hidden information (secret hands, face-down cards, roles)
  publicState(state)              // → redacted state broadcast to everyone in the room
  privateState(state, user)       // → per-player slice, delivered ONLY to that user
};
```

The **frontend** module (`games/<name>/app/index.js`) has a separate, smaller contract:
```js
export default {
  // Optional — pre-start configuration, shown in the platform's waiting room
  // (status 'lobby') for EVERY player, not just the host — the game decides
  // internally what a non-host sees there (or nothing). If your settings flow
  // needs its own Start trigger (e.g. configure() before start(), sometimes
  // async), render it here and call sdk.send('start', ...) yourself — the
  // platform's generic Start button is suppressed whenever this hook exists.
  renderSettings(el, sdk) { /* ... */ return () => { /* cleanup */ }; },

  // Required — called ONLY once a match is starting/active (or you're
  // reconnecting into one already playing/paused/finished). Never called
  // while the room is just waiting for players. Render gameplay only.
  mount(rootEl, sdk) { /* ... */ return () => { /* cleanup */ }; },
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
  user alone via the WebSocket `user` filter — carrying `privateState(state, user)`.
- On join/reconnect the platform sends the (re)joining user a private snapshot so
  they can render immediately.

Define neither hook → legacy behaviour (full state broadcast), unchanged.
This is a generic platform capability; game logic stays in `games/<name>/`.

### Adding a Game (4 files)

Use `games/tictactoe/` as reference — copy and adapt. `games/kaiten/` shows a
game that also uses `renderSettings` for pre-start configuration.

```
games/mygame/
  package.json     { "name": "@cap-games/mygame", "type": "module", "main": "index.js" }
                   // no "cds.games" needed — discovered as a game by its @cap-games/* name
  cds-plugin.js    empty marker file — makes CAP load the package
  index.js         backend — exports the interface above
  app/index.js     frontend — exports default { mount(rootEl, sdk), renderSettings? }
```

**`app/index.js`** is served automatically at `/games/<name>/index.js` by the platform (`srv/server.js`, UI folder defaults to `app`). The platform shell (`app/platform.js`) dynamically imports it and calls `mount()` only once the match is actually starting/active.

Activate: add `"@cap-games/mygame": "*"` to root `package.json` dependencies, then `npm install`.

---

## Data Model

| Entity | Purpose |
|---|---|
| `Rooms` | Active rooms — game type, host, status, settings (JSON) |
| `Players` | Players per room — user id, spectator flag, isHost |
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

- Team-play support (multiple players per side)
- Refactor games' inline CSS (tictactoe/kaiten/kaffee-kwest) onto the shared
  `var(--...)` design tokens so the light/dark theme toggle reaches game
  boards too — currently shell-only, games keep their own hardcoded palettes
