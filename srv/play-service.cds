using { cap.games.GameStatus } from '../db/schema';

/**
 * PlayService — WebSocket only.
 * All realtime gameplay: join, lobby management, moves, chat.
 */
@protocol: 'ws'
@path: 'play'
service PlayService {

  // --- Client → Server (actions) ---
  action join(room: String) returns String;                    // returns 'player' | 'spectator'
  action configure(room: String, settings: String);           // host only, JSON settings
  action start(room: String);                                  // host only, lobby → playing
  action move(room: String, data: String);                    // game-specific JSON move
  action rematch(room: String);                               // host only, finished → playing
  action backToRoom(room: String);                            // host only → back to room's waiting state (lobby)
  action switchGame(room: String, game: String);              // host only, lobby only — change the room's game
  action setRole(room: String, user: String, spectator: Boolean); // host only, lobby only — player ↔ spectator
  action kick(room: String, user: String);                    // host only
  action leave(room: String);
  action chat(room: String, text: String);
  action wsDisconnect();                                       // reserved: auto on disconnect

  // --- Server → Client (events, all room-scoped) ---
  event joined             { @ws.context room: String; player: String; spectator: Boolean; host: Boolean; status: GameStatus; }
  event configured         { @ws.context room: String; settings: String; }
  event started            { @ws.context room: String; firstTurn: String; state: String; }
  event moved              { @ws.context room: String; data: String; }
  event finished           { @ws.context room: String; winner: String; state: String; }
  event rematched          { @ws.context room: String; firstTurn: String; state: String; }
  event roomReset          { @ws.context room: String; }
  event gameSwitched       { @ws.context room: String; game: String; name: String; minPlayers: Integer; maxPlayers: Integer; }
  event roleChanged        { @ws.context room: String; player: String; spectator: Boolean; }
  // Full current roster (JSON array of { user, spectator, isHost }), sent to
  // (re)sync a client's player list — on join to an existing room and on
  // switchGame, when a client's game UI (re)initializes and would otherwise
  // only ever see *future* joined/playerLeft deltas, missing anyone already
  // present. Generic platform capability — see shell/players.js.
  event roster             { @ws.context room: String; players: LargeString; }
  // Per-recipient private state slice (hidden information). Delivered only to a
  // single user via the `user` emit filter. NO @ws.context here on purpose:
  // combining a room context with a user filter would OR them and broadcast to
  // the whole room. User-only scoping guarantees the slice reaches just its owner.
  event privateState       { room: String; data: String; }
  // Achievement unlocks earned by ONE user in a just-finished match. Like
  // privateState: NO @ws.context — delivered solely to its owner via the `user`
  // emit filter. `unlocked` is a JSON array of { id, game, name, desc }.
  event achievementUnlocked { unlocked: LargeString; }
  event playerLeft         { @ws.context room: String; player: String; newHost: String; }
  event playerKicked       { @ws.context room: String; player: String; }
  event playerDisconnected { @ws.context room: String; player: String; }
  event playerReconnected  { @ws.context room: String; player: String; }
  event chatMessage        { @ws.context room: String; player: String; text: String; ts: String; }
  event gameError          { @ws.context room: String; message: String; }
}
