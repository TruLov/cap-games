using { cap.games as db } from '../db/schema';

/**
 * ProfileService - OData/REST, no WebSocket.
 * Gamertag + avatar: a display layer over the stable `user` id used
 * everywhere else. Reads are open (any authenticated user can look up any
 * other user's gamertag/avatar - needed to label a room's roster); every
 * write is a dedicated action scoped to req.user.id, never generic OData
 * PUT/PATCH, so nobody can touch another user's row.
 */
@requires: 'authenticated-user'
@path: 'profile'
// saveAvatar posts base64 image bytes (~1.37x the raw ≤256KB cap enforced in
// profile-service.js) - raise express's body-parser limit past the default
// 100kb so a legitimate upload isn't rejected before ever reaching that check.
@cds.server.body_parser.limit: '400kb'
service ProfileService {

  // Avatar served as a real media stream: GET .../Profiles(user='...')/avatar
  @readonly entity Profiles as projection on db.Profiles;

  // Own gamertag - validated, upserted for req.user.id.
  action saveGamertag(gamertag: String) returns String;

  // Own avatar - `data` is base64-encoded image bytes (already resized
  // client-side); rejected if oversized or not an allowed mime type.
  action saveAvatar(data: String, mediaType: String) returns String;

  // Own profile summary (gamertag + whether an avatar is set + pinned badges).
  function myProfile() returns { gamertag: String; hasAvatar: Boolean; pinned: String };

  // Own pinned achievements for the rail badge row - up to 5, each
  // { game, id } validated against the caller's own Unlocks. Pass '[]' (or
  // an empty array) to clear the pin and fall back to the 5 latest unlocked.
  action setPinnedAchievements(pinned: String) returns String;

  // Batch resolve - lets the shell label a whole roster in one call instead
  // of one request per player.
  action profilesOf(users: many String) returns many { user: String; gamertag: String; hasAvatar: Boolean };
}
