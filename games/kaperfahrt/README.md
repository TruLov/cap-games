# @cap-games/kaperfahrt - Kaperfahrt

A pirate **dice** game for 2–5 players. Roll eight dice, press your luck for the
biggest combos, but three skulls and your whole turn is lost. First to **6000
points** triggers a final round; the highest total wins.

> **Inspiration & naming.** Kaperfahrt is inspired by the German dice game
> *Piraten Kapern* by Haim Shafir. The name, rules text, code, and art here are
> original - no assets or wording from the published game are used, and
> "Kaperfahrt" (German for "raiding voyage") is a deliberately distinct title.

## How a turn works

1. You automatically **draw a card** that shapes the round (see below).
2. **Roll** all 8 dice. Any skulls are set aside - they can never be rerolled.
3. Choose dice to keep, then **reroll at least 2** of the remaining dice. Repeat
   as often as you dare.
4. **Stop** to bank your score - or bust: the moment your **third skull** shows,
   the turn ends and you score **0** (except dice locked in a treasure chest).

## Scoring

| Same symbols | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|
| Points | 100 | 200 | 500 | 1000 | 2000 | 4000 |

- Each **gold coin** and **diamond** also scores **+100** on its own (and still
  counts toward a set).
- **Full chest** (+500): every die scores at once.
- **Nine of a kind** (only reachable via the coin/diamond card's 9th die): an
  instant win.

## The cards

| Card | Effect |
|---|---|
| **Sorceress** | Once this turn, reroll any dice - even a skull. |
| **Captain** | Your final turn score is doubled. |
| **Sea battle** | Collect ≥ N sabers (N = 2/3/4) for +300/+500/+1000 - fail and you **lose** that many points. |
| **Treasure chest** | Dice you store are safe: they still score even if you bust. |
| **Gold coin / Diamond** | Start the turn with a 9th die already showing a coin / diamond. |
| **Animals** | Monkeys and parrots count as the same symbol. |
| **Curse** | Start the turn with 1 or 2 skulls already set aside. |

Cards are drawn uniformly at random each turn (no depleting pile) - a small,
deliberate simplification for a digital game.

## Interface

Pure game logic (`game.js` → `flow.js` / `dice.js` / `deck.js`), no CAP imports,
per the platform's [Game Interface Contract](../../AGENTS.md). All state is public
(dice and cards are open), so there is no `publicState`/`privateState` projection.
Moves sent over `ws://…/ws/play` as `move` with a JSON `data` payload:

```
{"action":"roll"}
{"action":"reroll","dice":[0,3,5]}      // ≥2 active dice
{"action":"sorceress","dice":[2]}       // sorceress card only, once
{"action":"chest","dice":[1,4]}         // treasure-chest card only
{"action":"stop"}
```

## Look & feel

The UI (`app/index.js`) is a self-contained **pixel-art / Balatro-style** front end:
a fixed dark indigo palette (it ignores the shell's light/dark theme so it always
controls its own contrast), hand-authored 16×16 pixel sprites for the six die faces
and card icons (`app/sprites.js` - plain SVG, no binary assets), chunky beveled chip
buttons, a segmented progress bar per player, and animated "juice" (dice roll,
floating `+N` / `BUST` score pops, card slam-in, score count-up) that respects
`prefers-reduced-motion`.

Text uses the rounded-pixel **Pixelify Sans** font, bundled as `app/pixelify.ttf`
(SIL Open Font License - see `app/pixelify-OFL.txt`) and referenced by the
`@font-face` in `app/index.js`. If the file is ever missing, the UI gracefully
falls back to a bold monospace (`font-display:swap`).

## Test

```sh
npm test -w @cap-games/kaperfahrt
```
