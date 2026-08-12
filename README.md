# cap-games

Multiplayer browser game platform on SAP BTP - built with CAP Node.js.
Games are plugin packages. Add a game: 4 files, one dependency line, done.

**Included:** TicTacToe, Ultimate Tic-Tac-Toe (teams + blitz), Kaiten, Kaperfahrt, Flip Fortune

---

## Architecture

```mermaid
flowchart TB
    Browser["Browser<br/>Lobby: REST · Gameplay: WebSocket"]
    Approuter["Approuter<br/>IAS auth · websockets.enabled"]

    subgraph CAP["CAP Server (app/)"]
        Lobby["LobbyService<br/>OData /odata/v4/lobby<br/>browse games · create rooms · leaderboard"]
        Play["PlayService<br/>WebSocket /ws/play<br/>join · play · chat · host controls"]
        Registry["registry.js<br/>cds.games - games self-register via cds-plugin.js"]
        Engine["engine.js<br/>transient board state · reconnect grace · scoring"]
    end

    DB[("db/schema.cds<br/>Rooms · Players · Matches · Leaderboard")]
    Games["games/*<br/>tictactoe · mttt · kaiten · kaperfahrt · flipfortune"]

    Browser --> Approuter
    Approuter --> Lobby
    Approuter --> Play
    Lobby --> DB
    Play --> Engine
    Play --> Registry
    Play --> DB
    Registry --> Games
```

Room isolation via `@ws.context` - plugin broadcasts events only to clients in the same room.
Persistent state: Rooms, Players, Matches, Leaderboard in SQLite (dev) / Postgres (prod).
Transient: live board state, chat (not persisted - intentional).

Games are CAP plugins: each ships a `cds-plugin.js` that self-registers it onto
`cds.games` at boot - no platform code or config to touch (see "Adding a new
game" below).

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
# websocat for WebSocket testing - install via your package manager, e.g.:
brew install websocat        # macOS
cargo install websocat       # or download a release binary
```

---

## Quick Game (copy-paste)

See [`games/tictactoe/README.md`](games/tictactoe/README.md) for a full
copy-paste walkthrough (create room → join → play → finish) using the
reference game - the same file new game authors start from when copying
`games/tictactoe/` as a template.

---

## Lobby REST API

`GET /odata/v4/lobby/Games` - game catalogue
`GET /odata/v4/lobby/Rooms` - active rooms
`GET /odata/v4/lobby/Leaderboard` - leaderboard
`POST /odata/v4/lobby/createRoom` body: `{"game":"tictactoe"}` → roomId

Auth header: `Authorization: Basic <base64(user:user)>` (dev mocked)

---

## WebSocket Actions (PlayService)

| Action | Who | Status | Effect |
|--------|-----|--------|--------|
| `join(room)` | anyone | any | Join room; creator (via createRoom) becomes host |
| `configure(room, settings)` | host | lobby | Set game settings (JSON string) |
| `start(room)` | host | lobby | → playing |
| `move(room, data)` | current turn (`user` id) | playing | Game move (JSON string, game-specific) |
| `rematch(room)` | host | finished | → playing, keep players |
| `backToRoom(room)` | host | finished/playing/paused | → lobby (waiting room), all notified |
| `kick(room, user)` | host | any | Remove player/spectator |
| `leave(room)` | anyone | any | Leave voluntarily |
| `chat(room, text)` | anyone | any | Broadcast chat message (transient) |

## WebSocket Events

| Event | Key payload |
|-------|-------------|
| `joined` | `{ room, player, spectator, host, status }` |
| `configured` | `{ room, settings }` |
| `started` | `{ room, firstTurn }` - `firstTurn` is a `user` id |
| `moved` | `{ room, data }` - JSON game state |
| `finished` | `{ room, winner, state }` - `winner` is a `user` id or `'draw'` |
| `rematched` | `{ room, firstTurn }` |
| `roomReset` | `{ room }` |
| `playerLeft` | `{ room, player, newHost }` |
| `playerKicked` | `{ room, player }` |
| `playerDisconnected` | `{ room, player }` |
| `playerReconnected` | `{ room, player }` |
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

Copy `games/tictactoe/` as a starting point. Four files, no platform code to touch.
The full hook contract lives in [AGENTS.md](AGENTS.md#game-interface-contract) -
this is the shape:

**1. `games/mygame/package.json`**
```json
{ "name": "@cap-games/mygame", "version": "1.0.0", "type": "module" }
```

**2. `games/mygame/cds-plugin.js`** - the game's CAP hook: imports the pure
module and self-registers it onto `cds.games` (CAP runs this at boot).
```js
import cds from '@sap/cds';
import game from './game.js';
((cds.games ??= {}).mygame = { mod: game, dir: import.meta.url });
```
The platform then serves the game's `app/` at `/games/mygame` automatically.

**3. `games/mygame/game.js`** - pure backend logic, no CAP imports. Players are
identified by their `user` id (the platform assigns no symbols; derive marks
like X/O yourself from the `players` roster in `init`).
```js
export default {
  meta: { name: 'My Game', minPlayers: 2, maxPlayers: 4 },
  settingsSchema: { /* optional */ },

  // players: ordered roster [{ user, isHost }]; set state.turn to a user id -
  // the platform reads it to track whose move it is
  init(settings = {}, players = []) { return { turn: players[0]?.user, /* your state */ }; },

  // user = the acting player's id; end.winner = user | 'draw'
  applyMove(state, move, user) {
    // return { error: 'reason' }
    // return { state: newState, end: null }
    // return { state: newState, end: { winner: user|'draw' } }
  },
  // optional: score / pointsOf / publicState+privateState / onTick / extendService
  // - see AGENTS.md
};
```

**4. `games/mygame/app/index.js`** - frontend (ES module, full UI control)
```js
export default {
  mount(rootEl, sdk) {
    // Build your complete game UI into rootEl.
    // sdk.onState((state) => redraw(state))  - state lifecycle, pre-parsed
    // sdk.send('move', payload)              - send moves
    return () => { /* cleanup */ };
  }
};
```

**Activate:** add `"@cap-games/mygame": "*"` to root `package.json` dependencies, then `npm install`.

The platform provides: lobby, host, join, kick, settings, chat, reconnect, status machine, leaderboard - automatically. Your game only implements the rules and the board UI.

**Optional - own persistence/service:** a game can bring its own CDS model
(entities + OData service) with a `cds` section in its `package.json`:
```json
"cds": { "requires": { "mygame": { "model": "@cap-games/mygame/srv/service.cds" } } }
```

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
cf deploy mta_archives/cap-games_1.0.0.mtar -e trial.mtaext
```

Creates:
- `cap-games-srv` - CAP server
- `cap-games` - Approuter (IAS auth)
- `cap-games-ias` - IAS identity service
- `cap-games-postgres` - PostgreSQL database (`postgresql-db`/`trial`)

**Trial-account data is ephemeral by design:** BTP trial subaccounts expire
and get deleted, wiping every service instance in them regardless of which
database is used. No backup/export strategy is implemented - this deployment
is a demo/showcase, not a durable store.

**Post-deploy - IAS Self-Registration:**
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

- Adopt gamertags/avatars (`sdk.nameOf`/`sdk.avatarUrl`) inside game boards, not just the shell
