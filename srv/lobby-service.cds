using { cap.games as db } from '../db/schema';

/**
 * LobbyService — OData/REST, no WebSocket.
 * Browse games, create/list rooms, view leaderboard.
 */
@path: 'lobby'
service LobbyService {

  // Game catalogue — derived from the cds.games registry at runtime
  @readonly entity Games {
    key id          : String(50);
        name        : String;
        minPlayers  : Integer;
        maxPlayers  : Integer;
  }

  // Active rooms — created via createRoom action. gameName/playerCount/
  // maxPlayers are virtual — populated in an `after READ` handler from the
  // game registry + a Players count query (see lobby-service.js), so the
  // start page can list open rooms with a headcount without exposing the
  // full roster (Players is not a top-level entity here).
  @readonly entity Rooms as projection on db.Rooms {
    *,
    virtual null as gameName    : String,
    virtual null as playerCount : Integer,
    virtual null as maxPlayers  : Integer,
    virtual null as isMember    : Boolean,
  } excluding { createdBy, modifiedBy, createdAt, modifiedAt };

  // Leaderboard — gamertag is virtual, resolved in an `after READ` handler by
  // consuming ProfileService through `cds.connect.to` (see lobby-service.js),
  // so a ranking lists display names without leaking the ProfileService's
  // location: in-process today, a remote binding tomorrow, same call site.
  @readonly entity Leaderboard as projection on db.Leaderboard {
    *,
    virtual null as gamertag : String,
  };

  // Create a room and become its host
  action createRoom(game: String) returns String;  // returns room ID

  // Achievements the caller has unlocked, grouped by game ('' = platform-wide).
  // Deliberately returns ONLY owned entries plus a `total` per game — locked
  // achievement definitions are never disclosed (Steam-style hidden), so the
  // UI can show "3 / 8" and how many are left without revealing what they are.
  function myAchievements() returns many {
    game     : String;
    gameName : String;
    total    : Integer;
    owned    : many {
      id   : String;
      name : String;
      desc : String;
      at   : Timestamp;
    };
  };

  // The caller's platform identity (req.user.id) — the authoritative id the
  // frontend must key on so it matches every gameplay comparison. Under IAS
  // this is the token subject; under mocked auth it's the basic-auth user.
  function whoami() returns String;
}
