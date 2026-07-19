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
