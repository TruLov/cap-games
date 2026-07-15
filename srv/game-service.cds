@protocol: 'ws'
@path: 'game'
service GameService {

  // --- Client → Server ---
  action join(room: String) returns String;   // returns 'X' | 'O' | 'spectator'
  action move(room: String, cell: Integer);
  action leave(room: String);

  // --- Server → Client (broadcast to room context) ---
  event joined   { @ws.context room: String; player: String; symbol: String; }
  event moved    { @ws.context room: String; cell: Integer; symbol: String; board: String; nextTurn: String; }
  event finished { @ws.context room: String; winner: String; board: String; }
  event error    { @ws.context room: String; message: String; }
}
