using { cap.games.GameStatus } from '../db/schema';

/**
 * PlayService — WebSocket only.
 * All realtime gameplay: join, lobby management, moves, chat.
 */
@protocol: 'ws'
@path: 'play'
service PlayService {

  // --- Client → Server (actions) ---
  action join(room: String) returns String;                    // returns symbol
  action configure(room: String, settings: String);           // host only, JSON settings
  action start(room: String);                                  // host only, lobby → playing
  action move(room: String, data: String);                    // game-specific JSON move
  action rematch(room: String);                               // host only, finished → playing
  action backToLobby(room: String);                           // host only → lobby
  action kick(room: String, user: String);                    // host only
  action leave(room: String);
  action chat(room: String, text: String);
  action wsDisconnect();                                       // reserved: auto on disconnect

  // --- Server → Client (events, all room-scoped) ---
  event joined             { @ws.context room: String; player: String; symbol: String; host: Boolean; status: GameStatus; }
  event configured         { @ws.context room: String; settings: String; }
  event started            { @ws.context room: String; firstTurn: String; }
  event moved              { @ws.context room: String; data: String; }
  event finished           { @ws.context room: String; winner: String; state: String; }
  event rematched          { @ws.context room: String; firstTurn: String; }
  event lobbyReset         { @ws.context room: String; }
  event playerLeft         { @ws.context room: String; player: String; symbol: String; newHost: String; }
  event playerKicked       { @ws.context room: String; player: String; }
  event playerDisconnected { @ws.context room: String; player: String; symbol: String; }
  event playerReconnected  { @ws.context room: String; player: String; symbol: String; }
  event chatMessage        { @ws.context room: String; player: String; text: String; ts: String; }
  event gameError          { @ws.context room: String; message: String; }
}
