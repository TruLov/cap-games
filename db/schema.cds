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

// Players in a room. The per-room player identity is `user` (the platform
// invents no game symbols); `spectator` distinguishes watchers from players.
// `managed` gives createdAt — used to preserve original join order when a
// game switch re-splits players into player/spectator against a new maxPlayers.
entity Players : cuid, managed {
  room      : Association to Rooms;
  user      : String(255);
  spectator : Boolean default false;
  isHost    : Boolean default false;
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

// User profile — gamertag + avatar picture. Purely a DISPLAY layer: `user`
// stays the canonical identity everywhere else (rooms, moves, chat,
// leaderboard) — this only controls how a user is shown. All writes are
// scoped to the caller (see srv/profile-service.js) — nobody can edit
// another user's row, even though reads are open (needed to label a room's
// roster with everyone's gamertag/avatar).
entity Profiles {
  key user  : String(255);
  gamertag  : String(40);
  avatar    : LargeBinary @Core.MediaType: mediaType @Core.ContentDisposition.Filename: 'avatar.jpg';
  mediaType : String @Core.IsMediaType;
}
