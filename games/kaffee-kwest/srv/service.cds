using { kk } from '../db/schema';

/**
 * KaffeeKwestService — the plugin's own CAP app (OData).
 * Handles the async edges of a round, so the gameplay loop stays pure:
 * scenario library, profiles/chronicles, prepare (casting + frozen tree
 * -> settings JSON for `configure`), chronicle extraction + confirmation.
 */
@path: 'kaffee-kwest'
@requires: 'authenticated-user'
service KaffeeKwestService {

  entity Scenarios as projection on kk.Scenarios;

  // filtered to the requesting user in the handler
  @readonly entity MyChronicle as projection on kk.ChronicleEntries;

  function myProfile() returns String;                 // own archetype ('' if none)
  action saveProfile(archetype: String);

  /** party: JSON [{ user, isHost }] → settings JSON for `configure` */
  action prepare(scenario: String, party: LargeString) returns LargeString;

  /** finalState: JSON public state of a finished round → 0–2 suggested entries */
  action suggestChronicle(finalState: LargeString) returns array of String;

  /** persist player-confirmed entries (veto by omission); enforces the 7-active cap */
  action saveChronicle(entries: array of String, scenario: String) returns Integer;
}
