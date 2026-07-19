using { cuid, managed } from '@sap/cds/common';

namespace kk;

/** Quest templates ("szenario.md") — seeded from scenarios/*.json, maintainable via OData. */
entity Scenarios {
  key ID   : String(40);
  title    : String(100);
  setting  : String(255);
  premise  : LargeString;
  goal     : String(255);
  tone     : String(255);
  taboo    : String(255);
  length   : Integer;        // scene count shown as "Szene x von y"
  roles    : LargeString;    // JSON [{ role, hook, tags: [...] }]
  tree     : LargeString;    // JSON authored decision tree — powers the no-AI mode
}

/** "spieler.md" header — one archetype line per user. */
entity Profiles {
  key user  : String(255);
  archetype : String(255);
}

/** "spieler.md" chronicle — one scenario-neutral narrative sentence per entry. */
entity ChronicleEntries : cuid, managed {
  user     : String(255);
  text     : String(500);
  scenario : String(40);
  active   : Boolean default true;   // retired entries stay for history
}

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

  /** party: JSON [{ symbol, user, isHost }] → settings JSON for `configure` */
  action prepare(scenario: String, party: LargeString) returns LargeString;

  /** finalState: JSON public state of a finished round → 0–2 suggested entries */
  action suggestChronicle(finalState: LargeString) returns array of String;

  /** persist player-confirmed entries (veto by omission); enforces the 7-active cap */
  action saveChronicle(entries: array of String, scenario: String) returns Integer;
}
