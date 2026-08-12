/**
 * Compatibility shim - kaffee-kwest (games/kaffee-kwest) was extracted off
 * main in ce86f5b, but the deployed Postgres DB still has its tables.
 * CAP's Postgres schema evolution (schema_evolution: "auto") refuses to
 * drop tables automatically (migration-unsupported-table-drop) - there's
 * no auto-undeploy equivalent for the generic delta-migration path (that
 * flag only exists for HANA), so leaving the model silently mismatched
 * blocks the cap-games-postgres-deployer task on every deploy, including
 * for entities unrelated to kaffee-kwest (e.g. Profiles).
 *
 * These definitions exactly mirror the last version of
 * games/kaffee-kwest/db/schema.cds so nothing needs to change/drop.
 * Delete this file once someone with DB access manually drops
 * kk_Scenarios / kk_Profiles / kk_ChronicleEntries from the live database
 * - at that point kaffee-kwest is fully gone from main.
 */
using { cuid, managed } from '@sap/cds/common';

namespace kk;

entity Scenarios {
  key ID   : String(40);
  title    : String(100);
  setting  : String(255);
  premise  : LargeString;
  goal     : String(255);
  tone     : String(255);
  taboo    : String(255);
  length   : Integer;
  roles    : LargeString;
  tree     : LargeString;
}

entity Profiles {
  key user  : String(255);
  archetype : String(255);
}

entity ChronicleEntries : cuid, managed {
  user     : String(255);
  text     : String(500);
  scenario : String(40);
  active   : Boolean default true;
}
