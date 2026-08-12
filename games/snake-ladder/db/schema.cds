namespace snakeladder;

// Snake & Ladder keeps its OWN persisted tables (registered as this plugin's
// model via package.json → cds.requires."snake-ladder".model). The platform's
// Rooms/Players/Matches own the session lifecycle; these two tables are the
// game-specific persistence the platform doesn't provide:
//
//   BoardSquares - the static board (snakes/ladders), CSV-seeded, read once by
//                  extend.js and handed to the pure reducer as source of truth.
//   TurnLog      - append-only move history, written per move by extend.js.
//
// Row identity is by the platform's own ids (room = Rooms.ID, user = the token
// subject), so no association back to snake-ladder-owned session/player tables.

// ── Board square - pre-loaded with snake/ladder data ──────────────────────
entity BoardSquares {
    key square       : Integer; // 1–100
        snakeTo      : Integer; // 0 if no snake on this square
        ladderTo     : Integer; // 0 if no ladder on this square
        isDoubleHead : Boolean default false; // double-headed snake → also skips a turn
}

// ── Turn log - full history of every move across all rooms ─────────────────
entity TurnLog {
    key ID         : UUID;
        room       : String(36);  // platform Rooms.ID
        user       : String(255); // platform user id (token subject)
        turnNumber : Integer;
        diceRoll   : Integer;
        fromSquare : Integer;
        toSquare   : Integer;
        eventType  : String(20);  // 'normal' | 'ladder' | 'snake' | 'doubleSnake' | 'overshoot' | 'win'

        @cds.on.insert: $now
        timestamp  : Timestamp;
}
