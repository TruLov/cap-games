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

  // The caller's platform identity (req.user.id) — the authoritative id the
  // frontend must key on so it matches every gameplay comparison. Under IAS
  // this is the token subject; under mocked auth it's the basic-auth user.
  function whoami() returns String;

  // Public (unauthenticated): the active auth kind — 'mocked' locally, 'ias'
  // when deployed. Lets the anonymous frontend show the login that actually
  // works (dev player picker vs IAS login button) before any user exists.
  // Reachable without a token via a dedicated authenticationType:none approuter
  // route (see app/router/xs-app.json); @requires:'any' keeps CAP from gating it.
  @(requires: 'any')
  function authKind() returns String;
}
