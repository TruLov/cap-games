# @cap-games/flipfortune — Flip Fortune

A press-your-luck **card** game for 2–8 players. Flip cards from a shared deck,
one decision at a time: **Hit** (flip another) or **Stay** (bank what you have).
Flip a number you already hold and you **bust** — 0 for the round — unless a
Second Chance saves you. Collect **7 unique numbers** and it's a **Flip 7**:
the round ends immediately for **+15**. First to the target score (100/200/300)
with the sole highest total wins; a tie at the top plays another round.

> **Inspiration & naming.** Flip Fortune is inspired by the card game *Flip 7*
> (The Op / Mattel). The name, rules text, code, and art here are original — no
> assets or wording from the published game are used, and "Flip Fortune" is a
> deliberately distinct title.

## How a turn works

Players take turns one at a time. On your turn:

1. **Hit** — flip the top card of the deck onto your line.
   - A **number** (0–12) you don't already hold is added to your line.
   - A **duplicate number** busts you (0 for the round) — unless you hold a
     Second Chance, which cancels the bust and is consumed instead.
   - A **modifier** (+2/+4/+6/+8/+10/×2) sits on your line and boosts your
     round score if you stay in.
   - An **action card** resolves immediately: **you** pick who it targets
     (Freeze, Flip Three) or who receives a spare Second Chance.
2. **Stay** — bank your line and sit out the rest of the round (only once
   you've flipped at least one card).

You may not Stay with an empty line — a simple, faithful stand-in for the
physical game's "everyone gets an opening flip" deal.

### Action cards

| Card | Effect |
|---|---|
| **Freeze** | The flipper picks any still-active player (including themself) — that player is forced to Stay immediately. |
| **Flip Three** | The flipper picks any still-active player — that player is forced to flip exactly three cards in a row (auto-resolved by the engine; stops early on a bust or Flip 7). |
| **Second Chance** | Kept automatically. Flipping a second one hands it to an eligible active player without one (or it's discarded if nobody qualifies). |

## Scoring

A surviving (non-busted) line scores, in order:
**sum of number cards → doubled if a ×2 modifier is held → + any flat
modifiers (+2…+10) → +15 if it was a Flip 7.** A busted line scores 0.

## Interface

Pure game logic (`index.js` → `flow.js` / `deck.js` / `scoring.js`), no CAP
imports, per the platform's [Game Interface Contract](../../AGENTS.md). The
only hidden information is the *order* of the draw pile — every flipped card
is public — so `publicState`/`privateState` simply expose `drawCount`/
`discardCount` instead of the pile contents. Moves sent over `ws://…/ws/play`
as `move` with a JSON `data` payload:

```
{"action":"hit"}
{"action":"stay"}
{"action":"resolve","target":"<user>"}   // answering a pending action card
```

## Look & feel

The UI (`app/index.js`) matches Kaperfahrt's self-contained **pixel-art /
Balatro-style** look: a fixed dark palette (ignores the shell's light/dark
theme), hand-authored 16×16 pixel sprites for the action-card icons and card
back (`app/sprites.js` — plain SVG, no binary assets), a shared felt table of
per-player tableaus, a flip-reveal animation for the last card drawn, a
round-summary overlay showing everyone's line and score before the next round
starts, and a win screen. Respects `prefers-reduced-motion`.

Text uses the rounded-pixel **Pixelify Sans** font, bundled as
`app/pixelify.ttf` (SIL Open Font License — see `app/pixelify-OFL.txt`),
shared with Kaperfahrt.

## Test

```sh
npm test -w @cap-games/flipfortune
```
