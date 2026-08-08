import cds from "@sap/cds";

export default class GameService extends cds.ApplicationService {
  async init() {
    const { Players, BoardSquares, TurnLog } = this.entities;

    // Players, BoardSquares, TurnLog are already destructured at the top of init()
    // Make sure your top-of-init destructure includes ALL three:
    // const { Players, BoardSquares, TurnLog } = this.entities
    this.on("startGame", "GameSessions", async (req) => {
      const sessionID = req.params[0].ID;

      // All players start in Waiting — set the first in turn order to Playing
      const players = await SELECT.from(Players)
        .where({ session_ID: sessionID })
        .orderBy("turnOrder");

      if (players.length < 2) {
        return req.reject(400, "A game needs at least 2 players to start.");
      }

      await UPDATE(Players)
        .set({ TurnStatus: "Playing" })
        .where({ ID: players[0].ID });

      await UPDATE("snakeladder.GameSessions")
        .set({ startedAt: new Date().toISOString() })
        .where({ ID: sessionID });
    });

    this.on("endGame", "GameSessions", async (req) => {
      await UPDATE("snakeladder.GameSessions")
        .set({ finishedAt: new Date().toISOString() })
        .where({ ID: req.params[0].ID });
    });

    // ── startTurn ─────────────────────────────────────────────────────────
    // @from: [#Waiting]  →  CAP validates status before this runs
    // @to: #Playing      →  CAP updates status after this returns
    // No business logic needed — CAP's @flow.status handles the transition.
    this.on("startTurn", "Players", async (req) => {
      // Intentionally empty: the @from/@to annotations do all the work.
    });

    // ── rollDice ──────────────────────────────────────────────────────────
    // @from: [#Playing]  →  CAP validates status before this runs
    // @to: #Moving       →  CAP updates status after this returns
    this.on("rollDice", "Players", async (req) => {
      const player = await SELECT.one
        .from(Players)
        .where({ ID: req.params[0].ID });
      if (!player) return req.error(404, "Player not found");

      const roll = Math.ceil(Math.random() * 6);
      let newPosition = player.position + roll;

      // Can't overshoot square 100 — must land exactly
      if (newPosition > 100) {
        await UPDATE(Players).set({ lastRoll: roll }).where({ ID: player.ID });
        const needed = 100 - player.position;
        return req.reject(
          409,
          `Need exactly ${needed} to finish. Rolled ${roll}. No move.`,
        );
      }

      // Resolve snake or ladder on the new square
      const square = await SELECT.one
        .from(BoardSquares)
        .where({ square: newPosition });
      let finalPosition = newPosition;
      let event = null;

      if (square?.ladderTo) {
        finalPosition = square.ladderTo;
        event = { type: "ladder", from: newPosition, to: finalPosition };
      } else if (square?.snakeTo) {
        finalPosition = square.snakeTo;
        event = square.isDoubleHead
          ? { type: "doubleSnake", from: newPosition, to: finalPosition }
          : { type: "snake", from: newPosition, to: finalPosition };
      }

      // Persist position and last roll
      await UPDATE(Players)
        .set({ position: finalPosition, lastRoll: roll })
        .where({ ID: player.ID });

      // Emit domain event so subscribers (Week 3) can react
      if (event)
        await this.emit("BoardEvent", { playerID: player.ID, ...event });

      // Use req.reply() — not return — to pin the response value before CAP's
      // @flow.status after-handler runs. A plain `return` gets cleared by the
      // flow machinery, producing HTTP 204 instead of the expected 200 + body.
      req.reply({
        roll,
        position: finalPosition,
        event: event?.type ?? "normal",
      });
    });

    // ── confirmMove ─────────────────────────────────────────────────────────
    // After this returns, CAP sets status → #Waiting.
    // We then find the next player and set them to #Playing.
    this.on("confirmMove", "Players", async (req) => {
      // Players and TurnLog are already destructured at the top of init()
      const player = await SELECT.one
        .from(Players)
        .where({ ID: req.params[0].ID });
      if (!player) return req.error(404, "Player not found");

      // ── Check win condition before handing off ──
      if (player.position === 100) {
        // Delegate to winGame — correct CAP bound-action call syntax
        await this.send({
          event: "winGame",
          entity: "Players",
          params: [{ ID: player.ID }],
        });
        return;
      }

      // ── Log this turn ──
      const [{ n: count }] = await SELECT`count(*) as n`
        .from(TurnLog)
        .where({ session_ID: player.session_ID });
      const turnNumber = (count || 0) + 1;
      await INSERT.into(TurnLog).entries({
        ID: cds.utils.uuid(),
        session_ID: player.session_ID,
        player_ID: player.ID,
        turnNumber,
        diceRoll: player.lastRoll,
        fromSquare: player.prevPosition, // pre-roll position stored by rollDice
        toSquare: player.position,
        eventType: player.lastEventType ?? "normal", // event type stored by rollDice
        timestamp: new Date().toISOString(),
      });

      // ── Find next player in turn order ──
      const players = await SELECT.from(Players)
        .where({ session_ID: player.session_ID })
        .orderBy("turnOrder");

      const idx = players.findIndex((p) => p.ID === player.ID);
      // Skip finished players — guard counter prevents infinite loop if all finish simultaneously
      let nextIdx = (idx + 1) % players.length;
      let guard = 0;
      while (
        players[nextIdx].TurnStatus === "Finished" &&
        guard++ < players.length
      ) {
        nextIdx = (nextIdx + 1) % players.length;
      }
      const next = players[nextIdx];

      await this.emit("TurnComplete", {
        sessionID: player.session_ID,
        playerID: player.ID,
        nextPlayerID: next.ID,
        turnNumber,
      });

      // Activate next player — use direct UPDATE, not the flow action,
      // because we're already inside a handler
      await UPDATE(Players)
        .set({ TurnStatus: "Playing" })
        .where({ ID: next.ID });
    });

    // ── blockPlayer ───────────────────────────────────────────────────────
    // @from: [#Moving]  →  called when player lands on a double-headed snake
    // @to: #Blocked     →  player skips their next turn
    this.on("blockPlayer", "Players", async (req) => {
      // Business logic: the position was already updated in rollDice.
      // This action just transitions state — CAP handles the @to: #Blocked update.
      req.info("Player is blocked and will skip their next turn.");
    });

    // ── unblockPlayer ─────────────────────────────────────────────────────
    // @from: [#Blocked]   →  called at the start of a blocked player's next turn
    // @to: $flow.previous →  CAP restores the status to whatever it was before #Blocked
    this.on("unblockPlayer", "Players", async (req) => {
      // CAP's $flow.previous does the work — no code needed here.
      // The player's status returns to #Waiting automatically.
    });

    this.on("skipTurn", "Players", async (req) => {
      const player = await SELECT.one
        .from(Players)
        .where({ ID: req.params[0].ID });
      await UPDATE(Players)
        .set({ turnsBlocked: (player.turnsBlocked || 0) + 1 })
        .where({ ID: player.ID });
    });

    // ── winGame ───────────────────────────────────────────────────────────
    // @from: [#Moving]  →  called when player.position === 100
    // @to: #Finished    →  player has won
    this.on("winGame", "Players", async (req) => {
      const player = await SELECT.one
        .from(Players)
        .where({ ID: req.params[0].ID });
      if (!player) return req.error(404, "Player not found");

      // Mark the session as finished with this player as winner
      await UPDATE("snakeladder.GameSessions")
        .set({
          finishedAt: new Date().toISOString(),
          winner_ID: player.ID,
        })
        .where({ ID: player.session_ID });

      await this.emit("GameWon", {
        playerID: player.ID,
        sessionID: player.session_ID,
      });
    });

    this.on("mcpStartGame", async (req) => {
      // Use object form: string form puts params in req.data, not req.params
      await this.send({
        event: "startGame",
        entity: "GameSessions",
        params: [{ ID: req.data.sessionID }],
      });
      return `Game started for session ${req.data.sessionID}`;
    });
    this.on("mcpRollDice", async (req) => {
      return await this.send({
        event: "rollDice",
        entity: "Players",
        params: [{ ID: req.data.playerID }],
      });
    });
    this.on("mcpConfirmMove", async (req) => {
      await this.send({
        event: "confirmMove",
        entity: "Players",
        params: [{ ID: req.data.playerID }],
      });
      return `Move confirmed for player ${req.data.playerID}`;
    });
    this.on("mcpBoardState", async (req) => {
      return await SELECT.from(Players)
        .where({ session_ID: req.data.sessionID })
        .columns("name", "position", "TurnStatus", "lastRoll")
        .orderBy("turnOrder");
    });
    this.on("mcpBoardMap", async () =>
      SELECT.from(BoardSquares).orderBy("square"),
    );

    return super.init();
  }
}
