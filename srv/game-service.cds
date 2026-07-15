using { GameStatus } from './types';

@protocol: 'ws'
@path: 'game'
service GameService {

  // --- Client → Server ---
  action join(room: String, game: String) returns String;   // game: 'tictactoe' (default). returns symbol
  action configure(room: String, firstPlayer: String);      // 'X' | 'O' | 'random' — host only, lobby
  action start(room: String);                               // host only, lobby → playing
  action move(room: String, data: String);                  // game-specific move payload (JSON)
  action rematch(room: String);                             // host only, finished → playing
  action backToLobby(room: String);                         // host only, any → lobby
  action kick(room: String, user: String);                  // host only
  action leave(room: String);
  action wsDisconnect();                                    // reserved: auto-called on disconnect

  // --- Server → Client ---
  event joined             { @ws.context room: String; player: String; symbol: String; host: Boolean; status: GameStatus; }
  event configured         { @ws.context room: String; firstPlayer: String; }
  event started            { @ws.context room: String; firstPlayer: String; }
  event moved              { @ws.context room: String; data: String; }     // game-specific, opaque JSON
  event finished           { @ws.context room: String; winner: String; state: String; }
  event rematched          { @ws.context room: String; }
  event lobbyReset         { @ws.context room: String; }
  event playerLeft         { @ws.context room: String; player: String; symbol: String; newHost: String; }
  event playerKicked       { @ws.context room: String; player: String; }
  event playerDisconnected { @ws.context room: String; player: String; symbol: String; remaining: Integer; }
  event playerReconnected  { @ws.context room: String; player: String; symbol: String; }
  event gameError          { @ws.context room: String; message: String; }
}
