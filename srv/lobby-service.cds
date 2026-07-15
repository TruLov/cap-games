using { cap.games as db } from '../db/schema';

/**
 * LobbyService — OData/REST, no WebSocket.
 * Browse games, create/list rooms, view leaderboard.
 */
@path: 'lobby'
service LobbyService {

  // Game catalogue — derived from cds.env.games registry at runtime
  @readonly entity Games {
    key id          : String(50);
        name        : String;
        minPlayers  : Integer;
        maxPlayers  : Integer;
  }

  // Active rooms — created via createRoom action
  @readonly entity Rooms as projection on db.Rooms
    excluding { createdBy, modifiedBy, createdAt, modifiedAt };

  // Leaderboard
  @readonly entity Leaderboard as projection on db.Leaderboard;

  // Create a room and become its host
  action createRoom(game: String) returns String;  // returns room ID
}
