# Kaffee-Kwest — Software-Architekturkonzept

Umsetzung des Konzepts aus `docs/ideas/kaffee-kwest.md` als **CAP-Plugin** auf der
cap-games-Plattform. Dieses Dokument beantwortet drei Fragen:

1. Kann das Spiel vollständig als Plugin unter der bestehenden hexagonalen
   Plattform-Architektur gebaut werden?
2. Welche Funktionen gehören perspektivisch auf die Plattform?
3. Wie sieht der CAP-Best-Practice-Schnitt aus (Domänenkern, Ports, Adapter,
   eigene Datenhaltung im Plugin)?

---

## 1. Machbarkeitsanalyse: Plugin vs. Plattform

### 1.1 Was das Plugin-Modell bereits hergibt (verifiziert)

| Anforderung aus dem Konzept | Plattform-Mechanismus | Präzedenzfall |
|---|---|---|
| Lobby, Räume, Join-Codes, Host, Kick, Reconnect, Chat | Plattform (LobbyService/PlayService) — nichts zu tun | alle Games |
| Simultane Mechaniken (Abstimmung) statt Zugreihenfolge | `state.turn = 'all'`-Sentinel + Pending-Buffer im Game-State; die Plattform erzwingt keine Zugreihenfolge | Kaiten (`flow.js`) |
| Setup-Daten, die `init(settings)` braucht (Roster, Casting, Tree) | Host-UI schreibt sie vor `start` per `configure` in `Rooms.settings` | Kaiten (Roster via `configure`) |
| Tree vor Spielern verbergen | `publicState()`/`privateState()`-Projektion — Broadcasts enthalten nur den aktuellen Knoten, nie den Tree | Kaiten (Hidden Hands) |
| Eigene Persistenz (Chroniken, Szenarien) | Plugin registriert eigenes CDS-Modell **deklarativ** in seiner package.json: `"cds": { "requires": { "kaffee-kwest": { "model": "@cap-games/kaffee-kwest/srv/service.cds" } } }` (CAP merged die `cds`-Sektion jedes Plugins — dasselbe Muster wie @cap-js/sqlite/ai). Verifiziert gegen `@sap/cds@10.0.3`: `lib/compile/resolve.js` nimmt alle `requires.*.model`-Einträge in die Modellauflösung auf — Entities werden mit deployt, der Service wird serviert. **Kein Plattform-Code nötig.** | neu (dieses Plugin) |
| Eigene (asynchrone) API-Endpunkte für KI-Schritte | Plugin-eigener OData-Service (`KaffeeKwestService`) im Plugin-Modell — die "eigene CAP-App im Plugin" | neu (dieses Plugin) |

**Ergebnis: Das Spiel ist vollständig als Plugin baubar.** Kein `srv/`-File der
Plattform wird angefasst; Aktivierung wie gehabt über eine Dependency-Zeile.

### 1.2 Der eine harte Konflikt — und seine Auflösung

`init()` und `applyMove()` sind **synchron und pur** (Plattform-Konvention:
"Games are pure logic"). KI-Calls sind asynchron. Die Auflösung: **KI nur an den
Rändern der Runde, nie in der Spielschleife.**

```
Lobby ──[ KI-Punkt 1: prepare() — Casting + Tree (großes Modell) ]──► configure ► start
  │
  ▼
Spielschleife: rein deterministisch (Tree + seeded RNG) — KEIN KI-Call nötig
  │
  ▼
Finished ──[ KI-Punkt 2: suggestChronicle() — Extraktion (großes Modell) ]──► Bestätigung ► DB
```

- **`prepare`** (OData-Action im Plugin-Service): lädt Szenario + Chroniken,
  ruft den TreeBuilder-Port, liefert das komplette Settings-JSON (Casting +
  eingefrorener Tree + Seed). Die Host-UI schreibt es per `configure` und
  startet. Danach ist `init(settings)` trivial und pur.
- **Erzähltexte** stehen im Tree (beim `prepare` erzeugt bzw. im Szenario
  vorverfasst). Der Per-Knoten-Call des kleinen Modells ist damit in v1 gar
  nicht nötig — genau der Fallback, den das Konzept (§7) ohnehin vorschreibt:
  "das Backend kann mit den Knoten-Zusammenfassungen weiterspielen".
- **Freitext-Klassifikation** (Einzelmoment) läuft in v1 als purer
  Keyword-Matcher im Domänenkern (synchron, deterministisch). Ein späterer
  KI-Klassifikator läuft als OData-Action *vor* dem Move: UI klassifiziert
  asynchron, sendet dann den Move mit der gemappten Option — `applyMove` bleibt pur.

### 1.3 Was auf die Plattform gehört (Kandidaten, für v1 nicht nötig)

| Kandidat | Warum Plattform | v1-Workaround im Plugin |
|---|---|---|
| **KI-Orchestrierung** (AI-Core-Destination, Modell-Konfigurationen groß/klein, strukturierte Ausgaben) | Querschnitt — jedes KI-Game bräuchte sie wieder | Ports im Plugin mit statischen Default-Adaptern; AI-Core-Adapter ist eine austauschbare Datei |
| **Server-seitige Timer** (Vote-Timeout 60 s, Zug-Uhren) | Generische Realtime-Mechanik, braucht Zugriff auf Broadcast + Board-State | Host kann per `forceVote`-Move mit den abgegebenen Stimmen auflösen |
| **Roster an `init(settings)`** | Zwei Games (Kaiten, Kaffee-Kwest) brauchen jetzt den Configure-Umweg | Kaiten-Muster wiederverwendet |
| **Server-gehaltene Secret-Settings** | `configure` broadcastet die Settings (inkl. Tree) an den Raum — ein DevTools-Cheat kann den Tree lesen | Bewusster Trade-off: Co-op-Kaffeepausenspiel, kein kompetitiver Anreiz; UI zeigt den Tree nie. Sauber wäre: Plattform hält "private settings" serverseitig |
| **Per-User-Profilspeicher** | *Kein* Kandidat — bewusst Plugin-Sache: Chroniken sind Kaffee-Kwest-Domäne (eigener Bounded Context) | Plugin-eigene Entities |

---

## 2. Hexagonale Architektur des Plugins

```
                         ┌────────────────────────────────────────────────┐
   Driving Adapters      │              DOMÄNENKERN (pur, ohne CAP)       │      Driven Adapters
                         │                                                │
 Plattform-Contract ────►│  lib/tree.js         Decision-Tree-Engine      │
 (index.js:              │                      vote / roll / moment,     │
  init/applyMove/score/  │                      seeded RNG, Enden         │
  publicState/private…)  │                      Casting, Klassifikation,  │
                         │                      Chronik-Heuristik         │
 KaffeeKwestService ────►│                                                │
 (srv/…-service.js,      │                                                │
  OData: prepare,        │  PORTS (lib/ai-static.js als Default-Adapter): │
  suggest-/saveChronicle)│   • treeBuilder(scenario, party) → {casting,   │──► static (Default:
                         │     tree, seed}                                │    autor. Tree + Heuristik)
 UI (app/index.js) ─────►│   • chronicler(protocol, party) → Vorschläge   │──► aicore (später:
  via Platform-SDK (WS)  │                                                │    2 Modelle, JSON-Schema)
  + fetch (OData)        └────────────────────────────────────────────────┘
                                             │
                                             ▼
                          Plugin-eigene Persistenz (index.cds):
                          kk.Scenarios · kk.Profiles · kk.ChronicleEntries
                          (SQLite dev / HANA prod — deployt wie Plattform-Schema)
```

**Regeln:**
- Der Domänenkern importiert kein CAP, macht keine I/O — testbar mit `node --test`.
- Der Adapterwechsel (statisch ↔ KI) läuft über Konfiguration:
  `cds.requires.kaffee-kwest.ai = 'none' | 'aicore'` — Default `none`, damit
  `cds watch` ohne jede KI voll spielbar ist.
- Die Plattform wird ausschließlich über ihre öffentlichen Verträge genutzt
  (Game-Interface, SDK, `configure`); Erweiterung statt Modifikation.

---

## 3. Bausteine

### 3.1 Datenmodell (Plugin-eigen, Namespace `kk`)

| Entity | Zweck | entspricht im Konzept |
|---|---|---|
| `Scenarios` | Quest-Vorlagen: Prämisse, Ton, Länge, Tabu, Rollenpool + **autorisierter Tree** (JSON) für den No-AI-Modus | `szenario.md` |
| `Profiles` | `key user`, Archetyp (1–2 Zeilen) | Kopf der `spieler.md` |
| `ChronicleEntries` | Chronik-Sätze pro User: Text, aktiv/Ruhestand, Quelle (Szenario) | Chronik der `spieler.md` |

Szenarien werden beim Serverstart aus `db/data/*.json` in die DB
gespielt (Upsert) — Admins können sie danach per OData pflegen. Deckel-Regel:
max. 7 aktive Chronik-Einträge; beim Bestätigen neuer Einträge werden die
ältesten in den Ruhestand versetzt (Verdichtung per KI: später).

### 3.2 KaffeeKwestService (OData, `/odata/v4/kaffee-kwest`)

| Operation | Wer | Zweck |
|---|---|---|
| `Scenarios` (CRUD) | alle lesen, Pflege = Admin | Szenario-Bibliothek |
| `MyProfile()` / `saveProfile(archetype)` | jeder für sich (`req.user.id`) | Archetyp pflegen |
| `MyChronicle()` | jeder für sich | eigene Chronik anzeigen |
| `prepare(scenario, party)` | Host-UI | Casting + Tree + Seed → Settings-JSON für `configure` |
| `suggestChronicle(protocol)` | jede Spieler-UI im Finale | 0–2 Vorschläge (Port: Heuristik/KI) |
| `saveChronicle(entries)` | jeder für sich | nur bestätigte Einträge persistieren (Spieler-Veto) |

### 3.3 Game-State (transient, im Plattform-Engine-Board)

```js
state = {
  turn: 'all', phase, seed, rng,             // Simultan-Sentinel + deterministisches Würfeln
  symbols, host,                             // Party
  casting: { X: { role, hook } },            // aus prepare()
  tree: { start, nodes },                    // eingefroren, nie broadcastet
  nodeId, sceneNo, sceneTotal,               // Fortschritt
  votes: {},                                 // Buffer der Gruppenentscheidung
  log: [ … ],                                // Protokoll = Spielstand (Rejoin trivial)
  ending: null,
}
```

`publicState()` ersetzt `tree` durch eine Sicht auf den **aktuellen** Knoten
(Prosa, Optionstexte, Mechanik, Würfelziel, Stimm-Status). `privateState()`
ergänzt den persönlichen Erzähl-Haken. Zukunftsknoten, Zielknoten und
Zweig-Logik verlassen den Server nie.

### 3.4 Mechaniken als Moves (genau drei + Host-Auflösung)

| Move | Symbol | Wirkung |
|---|---|---|
| `{ type:'vote', option }` | alle | Buffer; Auflösung bei Vollständigkeit, Gleichstand → seeded Münzwurf |
| `{ type:'forceVote' }` | Host | Timeout-Ersatz: löst mit abgegebenen Stimmen auf (Rest: Zufall) |
| `{ type:'roll' }` | benannter Spieler | seeded W20 ± Chronik-Bonus vs. Zielwert → Zweig |
| `{ type:'moment', text }` | benannter Spieler | Keyword-Klassifikation auf eine der vordefinierten Optionen |

Enden sind Knoten mit `ending`. Co-op: `end.winner = 'draw'` (Plattform-
Semantik), eigenes `score()` vergibt Punkte nach Endqualität (gut 3 / gemischt 2
/ schlecht 1) an alle Aktiven.

### 3.5 Rundenablauf (End-to-End)

1. **Lobby:** Host wählt Szenario (OData), Spieler pflegen Archetyp, sehen ihre Chronik.
2. **Prepare:** Host-UI ruft `prepare(scenario, party)` → Settings-JSON →
   `sdk.send('configure')` → `sdk.send('start')` (Kaiten-Muster).
3. **Spielschleife:** pro Knoten Prosa + Mechanik; jeder Move broadcastet den
   neuen `publicState`; Fortschritt "Szene x von y". Reconnect: Plattform-Grace
   + State-Snapshot — Runde bricht nie ab.
4. **Finale:** Endscreen aus `ending`; jede Spieler-UI holt
   `suggestChronicle(protocol)`, Spieler bestätigt/verwirft, `saveChronicle`.
   `rematch`/`backToLobby` wie gewohnt (neuer Seed ⇒ neue Würfe, gleicher Tree
   bis zum nächsten `prepare`).

---

## 4. Best-Practice-Checkliste (CAP)

- **Plugin-Mechanik:** Deklarative Registrierung über die `cds`-Sektion der
  Plugin-package.json (Game, UI, Modellbeitrag via `requires.*.model`);
  `cds-plugin.js` ist nur noch leere Marker-Datei — dieselbe Technik, mit der
  offizielle CAP-Plugins (@cap-js/sqlite, @cap-js/ai, …) sich einklinken.
- **Trennung Persistenz/Transienz:** Chroniken/Szenarien in DB (überleben
  Restart), Spielzustand transient im Engine-Board (bewusst flüchtig) — exakt
  der Plattform-Split.
- **Kein Zustand in Service-Closures**, CQL-Global-API, `ApplicationService`-
  Klassen — Plattform-Konventionen aus `AGENTS.md` gelten unverändert.
- **Determinismus:** Seed im Settings-JSON ⇒ reproduzierbare Runden in Tests
  (Kaiten-Muster `makeRng`).
- **Degradation statt Ausfall:** Jeder KI-Port hat einen statischen Adapter;
  die Runde ist ohne KI vollständig spielbar (schwache KI = besserer Text,
  gleiche Struktur).

## 5. Ausbaustufen

1. **v1 (dieses Increment):** statische Adapter, autorisierter Demo-Tree
   ("Der Fluch der Nebelmine"), volle Spielschleife, Chronik mit Veto + Deckel.
2. **v1.5:** AI-Core-Adapter für `treeBuilder`/`chronicler` (strukturierte
   JSON-Ausgabe, großes Modell), OData-Action `classify` (kleines Modell) als
   Vorstufe des Moment-Moves.
3. **v2 (mit Plattform-Beiträgen):** Plattform-`AIService`, server-seitige
   Timer, private Settings, Streaming der Prosa (kleines Modell pro Knoten).
