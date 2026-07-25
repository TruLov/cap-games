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
                          (SQLite dev / Postgres prod — deployt wie Plattform-Schema)
```

**Regeln:**
- Der Domänenkern importiert kein CAP, macht keine I/O — testbar mit `node --test`.
- Das Plugin **fordert nur einen AI-Service an** (`cds.connect.to('AiService')`)
  und ruft `chat()`; *wie* der implementiert ist, entscheidet die Plattform per
  Profil (`cds.requires.ai.kind`: `mock` als Default, `aicore` in
  `[hybrid]`/`[production]`). Liefert der Service nichts Brauchbares (mock/Fehler),
  fällt das Plugin auf seinen eigenen statischen Adapter zurück — `cds watch`
  ist damit ohne jede KI voll spielbar, ohne dass das Spiel `aicore` kennt.
- Die Plattform wird ausschließlich über ihre öffentlichen Verträge genutzt
  (Game-Interface, SDK, `configure`, `AiService`); Erweiterung statt Modifikation.

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

1. **v1 (umgesetzt):** statische Adapter, autorisierter Demo-Tree
   ("Der Fluch der Nebelmine" + "Die Zeitkapsel des Praktikanten"), volle
   Spielschleife, Chronik mit Veto + Deckel.
2. **v1.5 (umgesetzt):** AI-Core-Adapter für `chronicler` **und** `treeBuilder`
   — beide nutzen gpt-4o-mini via foundation-models-Deployment (SAP AI SDK).
   Noch offen: OData-Action `classify` (kleines Modell) als Vorstufe des
   Moment-Moves.
3. **v2 (mit Plattform-Beiträgen):** server-seitige Timer, private Settings,
   Streaming der Prosa (kleines Modell pro Knoten), `classify`-Action.

### 5.1 AI-treeBuilder: Architektur & Erkenntnisse

Der AI-generierte Tree ist die schwierigste v1.5-Komponente — ein LLM muss
einen **selbstreferenzierenden Graphen** produzieren (Knoten verweisen per ID
aufeinander), bei dem jede Referenz auf einen tatsächlich existierenden Knoten
zeigen muss. JSON-Schema (`response_format: json_schema`) erzwingt nur das
**Format** (Typen, Pflichtfelder) — nicht die **Semantik** (referenzielle
Integrität). Das musste separat gelöst werden:

**Generate → Validate → Repair, mit `nodeIds`-Vorabdeklaration:**

```
lib/tree-gen.js
  buildTreeMessages(scenario)      → Prompt (Regeln + Few-Shot-Beispiel)
  → aiChat(messages, {response_format: json_schema})
  validateTree(tree)               → 6 Invarianten (nodeIds-Konsistenz,
                                       Erreichbarkeit, Sackgassen, Pfadlänge)
  → bei Fehler: Repair-Call (Kontext fortgeführt, max. 2 Versuche)
  → wirft nach erschöpften Repairs — Aufrufer fällt auf statischen Tree zurück
  toEngineFormat(tree)             → Prototyp-Schema → lib/tree.js-Schema
```

**Kernerkenntnis (empirisch, nicht aus Doku ableitbar):** Der häufigste Fehler
war, dass das Modell eine ID in `option.next`/`roll.successNext`/`failNext`
schreibt, aber vergisst, später einen Knoten mit dieser ID anzulegen —
Buchhaltung bricht über 6+ Knoten zusammen. Ein Feld **`nodeIds`**, das im
Schema **vor** `nodes` steht, zwingt das Modell, sich zuerst zur vollständigen
ID-Menge zu committen (JSON-Properties werden in Schema-Reihenfolge generiert).
Das allein hob die Sofort-Trefferquote von ~33% auf ~90-100% (Test über
15+ Runs, zwei Szenarien) — deutlich wirksamer als ein volles Few-Shot-Beispiel
allein. Ein Modell-Wechsel (gpt-5-mini/claude) oder eine SAP-AI-Core-
Orchestration-Engine wurden bewusst **nicht** eingesetzt — Orchestration bietet
keine Struktur-Validierung, das Problem liegt in der Anwendungsschicht.

Der verbleibende Rest (~0-10% Fehlschlag) wird vom Repair-Loop aufgefangen;
schlägt auch das fehl, greift der reguläre Fallback auf den statischen
Demo-Tree — die Runde startet in jedem Fall.

**Übersetzungsschicht (`toEngineFormat`):** Das Generierungs-Schema (Array
`nodes` mit `id`-Feld, `roll.successNext`/`failNext`) unterscheidet sich
bewusst vom Engine-Schema (`lib/tree.js` erwartet `nodes` als Objekt `{id:
node}`, `roll.success`/`fail`, `moment`-Felder auf Knoten-Ebene). Array+id ist
schema-freundlicher für strukturierten Output; die Übersetzung passiert einmal
nach der Generierung. Ein Engine-Selbsttest (`init()` + ein simulierter Zug in
`_runTreeBuilder`) verifiziert vor der Rückgabe, dass der übersetzte Tree
wirklich mit der echten Engine kompatibel ist.

**Geteilte Spiellogik:** Casting (`castParty`) und Actor-/Bonus-Auflösung
(`resolveTree`) sind reine Spiellogik ohne KI-Bezug — beide Adapter
(`ai-static.js`, `ai-aicore.js`) nutzen dieselben Funktionen aus
`ai-static.js` (DRY, kein Duplikat).

---

## 6. AI-Core-Setup (Cross-Account)

Das Spiel ruft AI Core über einen **foundation-models**-Deployment-Endpunkt an
(SAP AI Core, anderer Global Account als die CAP-App auf BTP Trial).
Die Verbindung läuft über den modellierten Plattform-Service **AiService**
(`srv/ai-service.js`, `@protocol:'none'`), den das Spiel lose gekoppelt via
`cds.connect.to('AiService')` konsumiert — kein relativer Import in
Plattform-Interna.

### Voraussetzungen

- SAP AI Core Instanz mit **Generative AI Hub** (plan `extended` oder vergleichbar)
- Deployment: `foundation-models`-Scenario, Modell `gpt-4o-mini`, Status `RUNNING`
- Service Key der AI-Core-Instanz (JSON aus BTP Cockpit → Instanz → Service Keys)

### Konfigurationsprinzip: AI als Plattform-Service mit Default + Profilen

Die AI-Implementierung ist **Plattform-Sache**, nicht Spiel-Sache. Der
`AiService` (`srv/ai-service.js`) steckt sein Backend per Profil-Config ein:

- **Root-`package.json` `cds.requires.ai`** — Default + Overrides:
  `kind: "mock"` (Default/`[development]`: deterministischer Stub, keine
  Credentials), `[hybrid]`/`[production]`: `kind: "aicore"` (echtes Modell).
  Dazu `resourceGroup` (Default `default`); Deployment-ID + Secret kommen aus
  der Umgebung, nie aus committeten Dateien.
- **Das Spiel kennt kein `aicore`/`static`** mehr: `games/kaffee-kwest/package.json`
  fordert nur sein eigenes Modell an. Zur Laufzeit ruft es `AiService.chat()`
  und fällt bei Fehler/Stub auf seinen statischen Adapter zurück.
- **Credentials** löst das SAP AI SDK selbst auf — `AICORE_SERVICE_KEY` (lokal),
  VCAP-`aicore`-Binding (Produktion), `cds bind` (Hybrid). Keine eigene Prüfung
  im Code.
- **Reasoning-Modelle** (gpt-5\*, o1/o3/o4\*, ...) brauchen eine andere
  Request-Form als klassische Chat-Modelle wie `gpt-4o-mini`: `temperature`
  wird abgelehnt (nur der Default ist erlaubt) und ohne `reasoning_effort`
  verbrennt das Modell das gesamte Token-Budget auf unsichtbares Reasoning
  und liefert eine leere Antwort. `srv/ai/aicore.js` schaltet das per
  `AICORE_REASONING_MODEL=true`-Env-Var um (Deployment-Eigenschaft, analog
  zu `AICORE_DEPLOYMENT_ID` — kein Spiel-Code betroffen).

### Lokale Konfiguration

Lokal ist **keine** AI-Config nötig — Default-Profil = `mock`, das Spiel spielt
statisch. Um das echte Modell lokal zu testen:

1. `.env` anlegen (basierend auf `.env.example`, **nie committen**):
   ```
   AICORE_SERVICE_KEY='{"clientid":"...","clientsecret":"...","url":"...","serviceurls":{"AI_API_URL":"https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com"}}'
   AICORE_DEPLOYMENT_ID=d0a60fa69c65d580
   ```

2. Das `aicore`-Backend aktivieren — entweder ein Profil mit `kind: aicore`
   fahren (`--profile hybrid`) oder gezielt per Dot-Notation in `.env`
   (schaltet **nur** die AI um, nicht `db`/`auth`):
   ```
   cds.requires.ai.kind = aicore
   ```

3. Starten:
   ```bash
   node --env-file=.env npx cds watch --include games
   ```

4. Smoke-Test (verifiziert den Endpunkt ohne Spielsession):
   ```bash
   node --env-file=.env scripts/smoke-chronicler.mjs
   ```

Ohne Schritt 2 läuft alles statisch (mock-Backend + Plugin-Fallback) — Chronik-
Heuristik statt echtem Modell-Call, keine Abhängigkeit von Secrets.

### Bekannte Konfiguration (Stand: Juli 2026)

| Parameter | Wert |
|---|---|
| AI-Core-Region | `us-east-1` (AWS) |
| Basis-URL | `https://api.ai.prod.us-east-1.aws.ml.hana.ondemand.com` |
| Deployment-ID (gpt-4o-mini) | `d0a60fa69c65d580` |
| Scenario | `foundation-models` |
| API-Version (Azure OpenAI) | `2024-10-21` (vom SAP AI SDK verwaltet) |
| Resource Group | `default` |

### Produktiv (Cloud Foundry)

Die `aicore`-Instanz wird über `mta.yaml` gebunden (`cap-games-aicore`), das SAP
AI SDK liest den Service Key nativ aus dem VCAP-Binding — **kein**
`AICORE_SERVICE_KEY`-Env nötig. Nur die (nicht geheime, umgebungsspezifische)
Deployment-ID wird gesetzt:

```bash
# per mta-Extension / --var beim Deploy:
cf deploy … --var aicore-deployment-id=d0a60fa69c65d580
```

Das `[production]`-Profil aktiviert automatisch `cds.requires.ai.kind: "aicore"`
— kein weiteres Setting nötig.
