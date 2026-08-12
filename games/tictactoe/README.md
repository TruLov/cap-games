# @cap-games/tictactoe

The reference game plugin - copy this folder as the starting point for a new
game (see the root [README.md](../../README.md#adding-a-new-game-plugin)
"Adding a new game" section for the full contract). This file is what you get
by following that pattern: a minimal, fully playable game with no platform
wiring code of its own.

Tic-tac-toe is also the one place in the platform where players get marks:
`game.js`'s `init(settings, players)` assigns `X` to the first joiner and `O`
to the second, itself - the platform assigns no symbols to any game, it only
ever hands games an ordered `players` roster of `{ user, isHost }`.

## Quick Game (copy-paste)

**Step 1 - Create room (HTTP/REST; alice creates it and becomes host):**
```sh
curl -X POST http://localhost:4004/odata/v4/lobby/createRoom \
  -H "Authorization: Basic YWxpY2U6YWxpY2U=" \
  -H "Content-Type: application/json" \
  -d '{"game":"tictactoe"}'
# → {"value":"<roomId>"}
```

**Step 2 - Terminal A (alice joins first → gets X):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic YWxpY2U6YWxpY2U" ws://localhost:4004/ws/play
```
```
{"event":"join","data":{"room":"<roomId>"}}
{"event":"start","data":{"room":"<roomId>"}}
```

**Step 3 - Terminal B (bob joins second → gets O):**
```sh
websocat -t -H="Cookie: X-Authorization=Basic Ym9iOmJvYg==" ws://localhost:4004/ws/play
```
```
{"event":"join","data":{"room":"<roomId>"}}
```

**Step 4 - Play (X moves first, alternating):**
```
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":0}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":1}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":4}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":2}"}}
{"event":"move","data":{"room":"<roomId>","data":"{\"cell\":8}"}}
```
→ `finished`, winner: alice (X)

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
{"event":"backToRoom","data":{"room":"<roomId>"}}
```

See the root [README.md](../../README.md) for the full WebSocket Actions/Events
reference, auth header formats, and the base64 reference table for `alice`/`bob`/`carol`.
