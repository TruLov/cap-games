# Implementation Plan — Kaiten Party! (CAP Game Plugin)

This is a step-by-step, test-driven plan to implement Kaiten Party! as a self-registering
CAP game plugin inside the `cap-games` platform. It follows the platform's game contract
(`meta` / `settingsSchema` / `init` / `applyMove` / `score` / `extendService`) and the
project's [constitution.md](constitution.md) and [specification.md](specification.md).

> Reference implementation to copy from: `games/tictactoe/`.

---

## 0. Key architectural challenge (read first)

The platform's reference game (TicTacToe) is **turn-based, single-mover**: one player moves,
`applyMove` validates the turn, emits `moved`, next player moves. Kaiten is fundamentally different:

| Concern | TicTacToe (reference) | Kaiten Party! |
|---|---|---|
| Turn model | Sequential, one mover | **Simultaneous** — everyone picks, then reveal |
| Rounds | 1 | **3 rounds** + menu-selection phase |
| Hand state | none | Each player holds a hand that **rotates** to a neighbor each turn |
| Mid-game scoring | none | Uramaki scores mid-round; desserts score at game end |
| Bonus actions | none | Chopsticks / Spoon / Menu / Special Order / Takeout Box |
| End result | win/draw | **Ranking** of N players → map to leaderboard |

**Design decision — buffer simultaneous selections inside game state.**
The platform's `move` handler does **not** enforce whose turn it is — it delegates entirely to
`game.applyMove(state, move, symbol)`. So Kaiten's `applyMove` will:

1. Record the calling player's card selection into `state.pending[symbol]`.
2. If **not all** active players have selected yet → return updated `state` with **no reveal**
   (the platform emits `moved` carrying a redacted state; clients show "waiting").
3. Once the **last** player selects → resolve the turn: reveal all picks, apply card effects,
   rotate hands to neighbors, run any immediate (mid-round) scoring, advance turn/round.
4. When the 3rd round completes → return `{ state, end: { ranking } }`.

**`state.turn` contract.** The engine stores `b.turn = state.turn`. For a simultaneous game we set
`state.turn` to a sentinel that means "everyone" (e.g. the string `'all'`), and drive real logic from
`state.phase` / `state.pending`. The engine never blocks moves on `turn`, so this is safe.

**State redaction.** `applyMove` returns the full authoritative `state`, but the platform broadcasts
it to all clients via the `moved` event. Because hands are hidden information, the game must expose a
**view-projection** step so each client only sees its own hand. Two options — pick one in Step 6:
- **(A) Server-side per-player projection** via `extendService` custom events (recommended), or
- **(B) Ship only public state in `moved`** and deliver private hands through a dedicated
  `handDealt` event addressed per socket.

---

## 1. Scaffold the plugin package (mirror tictactoe)

Create the four-file plugin skeleton:

```
games/kaiten/
  package.json         { "name": "@cap-games/kaiten", "version": "1.0.0", "main": "game.js" }
  cds-plugin.js        register backend + static UI mount at /games/kaiten
  game.js              exports the platform game interface
  ui/index.js          exports default { mount(rootEl, sdk) }
```

- `cds-plugin.js`: copy tictactoe's verbatim, swap the id:
  ```js
  (cds.env.games ??= {}).kaiten = require('./game');
  cds.on('bootstrap', app =>
    app.use('/games/kaiten', express.static(path.join(__dirname, 'ui'))));
  ```
- Activate the game: add `"@cap-games/kaiten": "*"` to the **root** `package.json` dependencies,
  then run `npm install` so CAP auto-discovers the plugin.

**Do not touch `srv/`, `db/`, or `app/`** — the platform stays generic (per AGENTS.md).

**Checkpoint:** `npm install` → start server → game appears in the `/Games` lobby catalogue.

---

## 2. Test harness (TDD foundation)

The constitution mandates test-driven development. Establish tests **before** logic.

- Add a `games/kaiten/test/` folder.
- Use Node's built-in test runner (`node:test` + `node:assert`) to keep the game logic pure and
  dependency-free (the game must have **no CAP imports**, per AGENTS.md conventions).
- Add an npm script at the plugin (or root) level: `"test:kaiten": "node --test games/kaiten/test/"`.
- Write the **first failing tests** for the card catalogue and deck assembly (Step 3) before coding.

Every card strategy (Step 4) and every game-flow transition (Steps 5–8) gets a test written first.

---

## 3. Card catalogue & deck model

Create `games/kaiten/cards/catalogue.js` — the static data for all 181 cards.

- Define each card **type** with: `id`, `displayName`, `category`
  (`nigiri | roll | appetizer | special | dessert`), count in the full pool, and any per-card
  variants (Nigiri: egg/salmon/squid; Maki: 1/2/3 icons; Uramaki icon counts; Onigiri shapes;
  Fruit icon combos; background color for Soy Sauce/Tea).
- Model an individual card instance as a small immutable object (e.g.
  `{ type: 'nigiri', variant: 'squid' }`).

Create `games/kaiten/deck.js`:
- `assembleDeck(menu, playerCount)` → builds the pool from the selected menu
  (Nigiri always + 1 roll + 3 appetizers + 2 specials + 1 dessert).
- `dealCounts(playerCount)` → hand size per player (10/9/8/7).
- `dessertCounts(playerCount, round)` → desserts shuffled in per round (5/3/2 or 7/5/3).
- `shuffle(array, rng)` — inject a seedable RNG so tests are deterministic.

**Tests first:** deck composition per menu, correct card counts, deal sizes, dessert counts,
menu restrictions (Menu/Special Order banned at 7–8p; Spoon/Edamame banned at 2p).

---

## 4. Card scoring via the Strategy pattern

The constitution requires the **strategy pattern**: most cards share behavior, some need extra logic.

Create `games/kaiten/cards/strategies/` with one strategy per card type implementing a common
interface. Suggested interface:

```js
// each strategy may implement any subset:
{
  // called when a card is placed (handles placement rules, e.g. Nigiri-on-Wasabi)
  onPlay?(playerBoard, card, ctx),
  // immediate/mid-round effects (e.g. Uramaki threshold, Miso Soup same-turn discard)
  onTurnResolved?(allBoards, ctx),
  // end-of-round score contribution for this player's collection
  scoreRound?(playerBoard, allBoards, ctx) -> number,
  // end-of-game score contribution (desserts only)
  scoreGame?(playerBoard, allBoards, ctx) -> number,
  // bonus action cards that need extra input
  isBonusAction?: boolean,
}
```

- A `strategyFor(type)` factory returns the right strategy; a shared **default** strategy covers
  the "just sits in front of you and scores at round end" majority.
- Implement each card's rules from the spec as an isolated strategy + unit test:

  | Group | Cards | Notable extra logic |
  |---|---|---|
  | Nigiri | Egg/Salmon/Squid | Auto-place on unoccupied Wasabi → triple |
  | Rolls | Maki, Temaki, Uramaki | Ranked/most-fewest; Uramaki **mid-round** threshold at 10 icons |
  | Appetizers | Tempura, Sashimi, Dumpling, Eel, Tofu, Onigiri, Edamame, Miso Soup | Sets, thresholds, per-opponent, same-turn discard |
  | Specials | Chopsticks, Spoon, Wasabi, Soy Sauce, Tea, Menu, Special Order, Takeout Box | Bonus actions & board-wide comparisons |
  | Desserts | Pudding, Green Tea Ice Cream, Fruit | **Scored at game end**, carry across rounds |

**Tests first, exhaustively**, using the exact point tables and edge cases from the spec
(ties, 2-player exceptions, 6–8p Maki tiers, Uramaki tie skipping, Fruit 0-card penalty, etc.).

---

## 5. `meta` & `settingsSchema` (menu selection)

In `game.js`:

```js
meta: { name: 'Kaiten Party!', minPlayers: 2, maxPlayers: 8 }
```

`settingsSchema` drives the host's pre-game configuration (via the platform `configure` action).
Model the menu selection here:
- `preset`: enum of the 8 predefined menus + `'custom'`.
- For `custom`: `roll`, `appetizers` (3), `specials` (2), `dessert` — each an enum of valid types.
- Validate player-count restrictions at `start` time (Step 7), not just in the schema.

**Tests first:** each preset resolves to the correct card-type set; custom validation rejects
illegal combinations and player-count-restricted cards.

---

## 6. `init(settings)` — game state shape

`init` builds the initial authoritative state for the whole 3-round game:

```js
{
  phase: 'playing',           // 'playing' | 'roundScoring' | 'gameOver'
  turn: 'all',                // sentinel — simultaneous game
  menu: {...},                // resolved card types in play
  round: 1,                   // 1..3
  players: [                  // ordered ring for neighbor passing
    { symbol, hand: [], played: [], desserts: [], roundScores: [], score: 0 }
  ],
  drawPile: [...],            // remaining shuffled cards
  pending: {},                // symbol -> selected card(s) this turn (hidden until reveal)
  uramakiAwarded: [],         // places already claimed mid-round (8/5/2)
  rng: <seed>,                // deterministic seed persisted in state
}
```

- Deal opening hands per Step 3.
- Because `init` runs on `start`, the concrete player symbols must be known — the platform passes
  only `settings` to `init`. **Resolve players lazily on the first `start`/reveal**, or use
  `extendService` to hook `start` and seed the roster. Decide here and document it. *(Recommended:
  add a tiny `extendService` that, on `started`, injects the real player symbols into board state,
  since `init` alone lacks the roster.)*

**Tests first:** initial deal is correct for 2–8 players; state is serializable (the platform
`JSON.stringify`s it into the `moved`/`started` events).

---

## 7. `applyMove` — the turn engine

This is the heart of the plugin. `applyMove(state, move, symbol)` returns
`{ state, end }` or `{ error }`.

Move shapes (game-specific JSON):
- `{ pick: <handIndex> }` — normal selection.
- `{ pick, bonus: 'chopsticks', pick2: <handIndex> }` — play a 2nd card via Chopsticks.
- `{ pick, bonus: 'spoon', cardType }` — Spoon request.
- `{ pick, menuChoice }` / `{ pick, specialOrderTarget }` / `{ pick, takeoutFlips: [...] }`
  — special cards needing extra input.

Algorithm:
1. **Guard**: game in `playing` phase; `symbol` is an active player; player hasn't already
   selected this turn; `pick` is a valid hand index.
2. **Record** selection into `state.pending[symbol]`. If not everyone has picked → return
   `{ state, end: null }` (redacted broadcast; "waiting for others").
3. **Resolve turn** when all picked:
   - Reveal picks; run each card's `onPlay` (Nigiri→Wasabi placement, etc.).
   - Run `onTurnResolved` strategies (Miso Soup same-turn discard, **Uramaki mid-round** scoring).
   - Move selected cards to each player's `played`; **rotate remaining hands** to next neighbor.
   - Return Chopsticks to the hand that used it; hand-off Spoon.
   - Clear `pending`.
4. **End of round** (all hands empty): run `scoreRound` for every strategy, append to
   `roundScores`, keep desserts in front, return non-dessert cards to draw pile, reshuffle with new
   desserts, deal next round. If round 3 just ended → go to step 5.
5. **End of game**: run `scoreGame` (desserts), sum totals, compute **ranking** with the dessert-count
   tie-breaker. Return `{ state: {...gameOver}, end: { ranking, winner } }`.

`end.winner` must satisfy the engine contract (a symbol or `'draw'`) — set it to the top-ranked
player's symbol (or `'draw'` on a true tie). Carry the full `ranking` array alongside for `score()`.

**Tests first** for: buffering until all pick; hand rotation direction; round rollover; dessert
carry-over; Uramaki mid-round threshold; full 3-round game producing a deterministic final ranking
(seeded RNG).

---

## 8. Bonus-action cards & extra service actions

Chopsticks, Spoon, Menu, Special Order, Takeout Box need input beyond a single `pick`. Two paths:

- **Preferred:** encode them as fields on the normal `move` payload (Step 7) so they flow through the
  existing `move` action — no new server actions, keeps the platform generic.
- **If richer round-trips are needed** (e.g. Menu's "draw 4, choose 1"), use the game's
  `extendService(srv)` hook to register **game-specific actions/events** on `PlayService`
  (the platform calls `game.extendService(this)` on `served`). Emit custom events like
  `menuOffer` / `spoonResolved` scoped to the room.

**Tests first:** each bonus card's effect on state; illegal usage rejected (e.g. Chopsticks with
one card left, Spoon naming an absent card type).

---

## 9. `score(end, players)` — leaderboard mapping

The platform upserts `Leaderboard` (wins/losses/draws/points) from `score()`'s return.
Map Kaiten's final ranking:

```js
score(end, players) {
  // end.ranking: [{ symbol, score }] sorted desc, with dessert tie-break already applied
  // → [{ user, result: 'win' | 'loss' | 'draw', points }]
}
```

- Top rank → `win`; a shared top rank → all `draw`; everyone else → `loss`.
- `points` = each player's final Kaiten score (so the leaderboard reflects real totals).
- Map `symbol` back to `user` via the `players` array.

**Tests first:** ranking → result/points mapping including ties.

---

## 10. Frontend — `ui/index.js` (`mount(rootEl, sdk)`)

Build the full game UI; the shell only owns login/lobby/header. Reuse shell components via DI
(`/shell/chat.js`, `/shell/players.js`, `/shell/host.js`), exactly like tictactoe.

Views/areas:
- **Menu config** (host, `lobby` status): pick a preset or build a custom menu → `sdk.send('configure', ...)`.
- **Hand**: the player's current cards; click a card → `sdk.send('move', { room, data: JSON.stringify({ pick }) })`.
  Show a "waiting for others" state after selecting.
- **Table**: each player's face-up `played` cards, desserts, and running score.
- **Bonus prompts**: contextual UI for Chopsticks / Spoon / Menu / Special Order / Takeout Box.
- **Round/scoreboard**: round-end and game-end summaries.

Subscribe to platform events and any custom game events, and **unsubscribe in the cleanup function**:
`started`, `moved`, `finished`, `rematched`, `lobbyReset`,
`playerDisconnected` / `playerReconnected`, plus custom Step-8 events.

**Hidden information:** ensure the client only renders its own hand (from the redacted/projected
state decided in Step 0). Never trust the client to hide cards it received.

---

## 11. Integration & end-to-end validation

- Run the full unit suite: `node --test games/kaiten/test/`.
- Manual multiplayer smoke test: start the server, open multiple browser sessions, run a full
  2-player and a 4-player game through all 3 rounds, exercising each menu and each special card.
- Verify reconnect grace (disconnect mid-round → rejoin within 60s → hand restored).
- Verify a completed game writes `Matches` + updates `Leaderboard` correctly.
- Confirm **no `srv/` or `db/` files were modified** — the game is a pure plugin.

---

## 12. Suggested milestone order

1. Steps 1–2: scaffold + test harness (green "hello game" in lobby).
2. Steps 3–4: catalogue, deck, and **all card strategies** with unit tests (bulk of the logic).
3. Steps 5–7: game flow (`meta`/settings/`init`/`applyMove`) — simultaneous engine + 3 rounds.
4. Step 8: bonus-action cards.
5. Step 9: leaderboard scoring.
6. Step 10: UI.
7. Step 11: integration & polish.

---

## Open decisions to confirm before coding

- **State projection strategy** (Step 0): server-side per-player events vs. public-only `moved`.
- **Roster injection** into `init` state (Step 6): `extendService` `started` hook vs. lazy resolve.
- **Bonus actions transport** (Step 8): fields on `move` vs. dedicated `extendService` actions.
- **Rematch semantics**: reshuffle a fresh 3-round game with the same menu (reuse `init`).
