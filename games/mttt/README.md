# @cap-games/mttt — Ultimate Tic-Tac-Toe

A 3x3 grid of tic-tac-toe boards. Winning an inner board claims that cell on
the outer board; the cell you play in dictates which inner board your
opponent must play next — unless that board is already decided, in which
case they're free to play anywhere. Supports **teams**: multiple players can
share X or O and take turns within their team.

## Credit

Design and rules ported from [mschleeweiss/mttt](https://github.com/mschleeweiss/mttt)
by **mschleeweiss (Marc)** — used with his permission. His version is a full
NestJS + Socket.io + Vue app; this is a from-scratch reimplementation of the
board/win-condition/team-turn rules in this platform's pure-function style
(see the root [AGENTS.md](../../AGENTS.md)'s Game Interface Contract),
sharing no code with the original. Thanks, Marc! 🙌

## How teams work

Team choice is self-service and happens pre-start, in the platform's waiting
room: every player picks X or O for themselves (and can switch), live for
everyone. This needed a small, first-of-its-kind extension to the platform's
WS protocol — `srv/extend.cds` `extend`s the platform's `PlayService` with a
`chooseTeam` action and a `settingsChanged` event, registered via this
game's `extendService(srv)` hook (see `AGENTS.md` — every game may
optionally add its own actions/events this way). Team picks are stored in
the room's existing generic `settings` field, merged in (not overwritten) —
the platform's `configure` action does a blind overwrite and is host-only,
so both team picks and blitz config (below) go through their own
merge-safe actions instead.

Once a match starts, turn order alternates team every move (regardless of
team size), and cycles through a team's members by move count — so a
3-member team gets every 6th global move each, not more or less often just
for having more players.

## Blitz mode (per-move timer)

The host can enable a per-move countdown before starting (`configureBlitz`,
5-120 seconds, host only, locked once the match starts). If a player doesn't
move in time, their turn is skipped (not an instant loss) and play passes to
the next player in rotation — enforced server-side regardless of what the
client shows. The configured seconds are baked into the match's state at
`start` (`state.blitz`), so it can't change mid-match.

## Quick Game

```sh
# alice creates a room
curl -X POST http://localhost:4004/odata/v4/lobby/createRoom \
  -H "Authorization: Basic YWxpY2U6YWxpY2U=" -H "Content-Type: application/json" \
  -d '{"game":"mttt"}'
# → {"value":"<roomId>"}
```

Then, over `ws://localhost:4004/ws/play` (one connection per player):

```
{"event":"join",          "data":{"room":"<roomId>"}}
{"event":"chooseTeam",    "data":{"room":"<roomId>","team":"X"}}
{"event":"configureBlitz","data":{"room":"<roomId>","enabled":true,"seconds":30}}  // host only
{"event":"start",         "data":{"room":"<roomId>"}}     // host only, once both teams have ≥1 player
{"event":"move",          "data":{"room":"<roomId>","data":"{\"cell\":0}"}}
```

`cell` is a flat index 0-80: `outerBoard * 9 + innerCell` (both 0-8,
row-major 3x3).
