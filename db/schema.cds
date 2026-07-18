using { cuid, managed } from '@sap/cds/common';
namespace cap.games;

type GameStatus : String enum { lobby; playing; finished; paused; }

// Active rooms
entity Rooms : cuid, managed {
  game     : String(50);
  host     : String(255);
  status   : GameStatus default 'lobby';
  settings : LargeString;   // JSON — game-defined settings
  code     : String(4);     // short human-typeable join code
  players  : Composition of many Players on players.room = $self;
}

// Players in a room
entity Players : cuid {
  room   : Association to Rooms;
  user   : String(255);
  symbol : String(10);      // 'X'/'O' — game-defined
  isHost : Boolean default false;
}

// Completed matches — persistent history
entity Matches : cuid, managed {
  game    : String(50);
  room    : String(36);     // room ID at time of match
  winner  : String(255);    // user id or 'draw'
  players : LargeString;    // JSON snapshot
  state   : LargeString;    // JSON final board state
}

// Leaderboard — upserted after each match
entity Leaderboard {
  key user   : String(255);
  key game   : String(50);
  wins       : Integer default 0;
  losses     : Integer default 0;
  draws      : Integer default 0;
  points     : Integer default 0;
}
