# Kaffeepausen-Quest — Konzept

Ein rundenbasiertes, KI-gehostetes Mini-Abenteuer für 2–6 Kolleg:innen. Eine Runde dauert 10–20 Minuten, läuft im Browser und wird von einer KI als Game Master geleitet. Die Charaktere der Spieler entwickeln sich über Szenarien hinweg weiter — nicht über Stats, sondern über eine persönliche Chronik.

---

## 1. Grundidee in einem Absatz

Ein Admin definiert vorab ein kurzes Szenario (`szenario.md`). Jeder Spieler besitzt eine minimale Charakterdatei (`spieler.md`). Beim Start einer Runde castet die KI die generischen Charaktere in szenario-passende Rollen (Ritter, Goblin, Flottenkommandant …) und generiert einen **festen, kleinen Decision Tree** mit 2–3 möglichen Enden. Danach erzählt ein kleineres Modell die Geschichte Knoten für Knoten, immer strikt innerhalb des Trees. Die Spieler treffen an jedem Knoten gemeinsam eine Entscheidung oder lösen eine simple Spielmechanik aus. Am Ende extrahiert die KI 1–2 prägende, szenario-unabhängige Merkmale pro Spieler und schreibt sie in dessen Chronik zurück.

---

## 2. Rollen

| Rolle | Aufgabe |
|---|---|
| **Admin** | Erstellt und pflegt Szenarien (`szenario.md`). Einmalige Vorarbeit, nicht pro Runde nötig. |
| **Host** | Öffnet eine Lobby, wählt Szenario, lädt Spieler per Link/Code ein, startet die Runde. Spielt selbst mit. |
| **Spieler** | Bringt seine `spieler.md` mit, trifft Entscheidungen, würfelt, stimmt ab. |
| **KI Game Master** | Casting, Tree-Generierung, Erzählung, Auswertung, Chronik-Update. Kein Mensch nötig. |

---

## 3. Die zwei Dateien

### 3.1 `spieler.md` — bewusst minimal

```md
# Jana
Archetyp: neugierig, redet sich gern raus
Chronik:
- Hat in einer Weltraumstation einen Reaktor durch Zureden beruhigt (gilt seitdem als "die Diplomatin")
- Hat Höhenangst, seit sie von einer Burgmauer gestürzt ist
- Ist schlauer geworden (hat ein antikes Rätsel im Alleingang gelöst)
```

Regeln:
- **Kein Name-Klasse-Stats-Block.** Nur ein Name, 1–2 Zeilen Archetyp/Persönlichkeit und die Chronik.
- Die Chronik ist **szenario-unabhängig formuliert**: Eigenschaften, Narben, Rufnamen, Marotten — Dinge, die in jedem Setting funktionieren.
- Neue Spieler starten mit leerer Chronik. Das ist okay — die KI castet sie dann als "unbeschriebenes Blatt".

### 3.2 `szenario.md` — die Quest-Vorlage des Admins

```md
# Der Fluch der Nebelmine
Setting: düsteres Mittelalter, verlassenes Bergwerk
Prämisse: Das Dorf schickt eine Gruppe in die Mine, aus der seit Tagen Nebel quillt.
Ziel: Quelle des Nebels finden und stoppen — oder fliehen.
Ton: leicht gruselig, aber mit Humor
Mögliche Enden (grob): Heldenhaft gelöst / Chaotisch entkommen / Der Nebel gewinnt
Länge: 5 Knoten
Tabu: keine Charaktertode
```

Regeln:
- Maximal ~20 Zeilen. Der Admin schreibt **keine** Geschichte, nur Prämisse, Ziel, Ton, grobe Endrichtungen.
- Das Feld `Länge` begrenzt den Tree (empfohlen: 4–6 Knoten → garantiert unter 20 Minuten).
- Optionales `Tabu`-Feld als Guardrail für die Erzählung.

---

## 4. Spielablauf einer Runde

### Phase 0 — Lobby (1 Min)
Host erstellt Raum, wählt Szenario, Spieler joinen per Link, laden/wählen ihre `spieler.md`. Host drückt "Start".

### Phase 1 — Setup durch das große Modell (einmalig, ~20–30 Sek)
Ein **starker Modell-Call** erhält `szenario.md` + alle `spieler.md` und erzeugt in einem Rutsch:

1. **Casting**: Pro Spieler eine Rolle im Setting, abgeleitet aus Archetyp und Chronik. Janas Chronik-Eintrag "Diplomatin" macht sie im Mittelalter-Szenario z. B. zur Unterhändlerin des Dorfes; ihre Höhenangst wird als Erzähl-Haken vermerkt.
2. **Decision Tree**: Fester Graph aus 4–6 Story-Knoten mit 2–3 Enden. Jeder Knoten enthält: eine Szenen-Zusammenfassung (2–3 Sätze als Leitplanke, noch keine ausformulierte Prosa), die anstehende Spielmechanik, 2–3 Optionen und deren Zielknoten.

Der Tree ist danach **eingefroren**. Er wird den Spielern nie gezeigt.

### Phase 2 — Spielschleife (10–15 Min)
Pro Knoten:

1. **Erzählung**: Das **kleine Modell** bekommt nur den aktuellen Knoten (Zusammenfassung + Optionen), das Casting und die letzten 1–2 Erzählabschnitte. Es schreibt 3–6 Sätze Prosa und formuliert die Optionen szenengerecht aus. Es darf nichts erfinden, was Optionen oder Zielknoten verändert.
2. **Mechanik** (siehe Abschnitt 5): Entscheidung, Würfelprobe oder Abstimmung — je nachdem, was der Knoten vorschreibt.
3. **Auflösung**: Ergebnis bestimmt deterministisch den nächsten Knoten (steht im Tree). Das kleine Modell schreibt 1–2 Übergangssätze.

Ein sichtbarer **Timer/Fortschrittsbalken** ("Szene 3 von 5") hält das Kaffeepausen-Versprechen.

### Phase 3 — Finale & Chronik (2 Min)
- Das kleine Modell erzählt das erreichte Ende (eines der 2–3 vordefinierten).
- Ein abschließender Call des großen Modells bekommt das gesamte Spielprotokoll und extrahiert **pro Spieler 0–2 Chronik-Einträge** (siehe Abschnitt 6).
- Jeder Spieler sieht seine vorgeschlagenen Einträge und bestätigt sie per Klick (oder lehnt ab). Erst dann wird die `spieler.md` aktualisiert.
- Endscreen: erreichtes Ende, "MVP-Moment" der Runde, Chronik-Updates.

---

## 5. Spielmechaniken — genau drei

1. **Gruppenentscheidung**: Alle stimmen über 2–3 Optionen ab, Mehrheit gewinnt. Bei Gleichstand entscheidet ein KI-erzählter Münzwurf. Timeout 60 Sek → Zufall unter den abgegebenen Stimmen.
2. **Würfelprobe (W20)**: Der Knoten benennt einen Spieler (bevorzugt einen, dessen Rolle/Chronik zur Szene passt: "Jana, du bist die Diplomatin — überzeuge den Wächter"). Ein Klick würfelt animiert im Browser. Erfolg/Misserfolg gegen einen im Tree festgelegten Zielwert bestimmt den Zweig. Chronik-Merkmale können ±2 Bonus/Malus geben ("ist schlau geworden" → Bonus auf Rätsel; "hat ein Bein verloren" → Malus auf Flucht) — das legt das große Modell beim Tree-Bau fest, nicht das kleine Modell zur Laufzeit.
3. **Einzelmoment**: Ein Spieler tippt einen kurzen Freitext (max. 140 Zeichen), z. B. was sein Charakter dem Drachen sagt. Das kleine Modell baut den Text in die Erzählung ein, **mappt ihn aber nur auf eine der vordefinierten Optionen** (Klassifikation, keine freie Story-Abzweigung). Das gibt Freiheitsgefühl ohne Tree-Bruch.

Mehr braucht es nicht. Jeder Knoten nutzt genau eine der drei Mechaniken; ein guter Tree wechselt sie ab.

---

## 6. Charakterentwicklung: das Chronik-System

Der Kern-Twist des Spiels. Prinzipien:

- **Narrativ statt numerisch.** Einträge sind ein Satz in natürlicher Sprache, szenario-neutral formuliert. Aus "hat den Goblin-König überlistet" wird der Eintrag "gilt als gerissen, seit er einen König überlistet hat".
- **Extraktion nach der Runde**: Das große Modell bekommt das Protokoll und Regeln wie: nur wirklich prägende Momente (kritische Erfolge/Fehlschläge, mutige Einzelmomente, wiederholtes Verhalten); maximal 2 Einträge pro Runde; auch 0 ist erlaubt.
- **Spieler-Veto**: Kein Eintrag ohne Bestätigung des Spielers. Verhindert unerwünschte Merkmale ("hat ein Bein verloren" sollte man sich aussuchen dürfen — manche wollen genau sowas, andere nicht).
- **Deckel & Verdichtung**: Maximal ~7 aktive Einträge. Ist die Chronik voll, schlägt die KI vor, zwei alte Einträge zu einem zu verdichten ("mehrfach als klug aufgefallen" statt drei Einzelbelegen) oder einen alten in den Ruhestand zu schicken. So bleibt die Datei klein und der Prompt-Kontext billig.
- **Rückkopplung**: Beim nächsten Casting nutzt die KI die Chronik aktiv — als Rollenvorschlag, Erzähl-Haken und Würfelmodifikator. Dadurch fühlt sich der Charakter über Settings hinweg wie *dieselbe Person* an, obwohl er mal Ritter, mal Goblin, mal Kommandantin ist.

---

## 7. KI-Architektur (zwei Modelle über SAP AI Core)

| Aufgabe | Modell | Wann | Warum |
|---|---|---|---|
| Casting + Decision-Tree-Generierung (strukturiertes JSON) | Großes Modell | 1× beim Start | Braucht Kohärenz, Kreativität, Regeltreue |
| Szenen-Prosa, Optionstexte, Übergänge, Freitext-Klassifikation | Kleines Modell | Pro Knoten | Schnell (<3 Sek), günstig, durch den Tree eng geführt |
| Chronik-Extraktion + Verdichtung | Großes Modell | 1× am Ende | Urteilsvermögen, was "prägend" ist |

Der Tree ist der zentrale Sicherheitsmechanismus: Das kleine Modell kann die Geschichte stilistisch färben, aber strukturell nichts kaputt machen, weil Optionen, Zielknoten und Würfelschwellen fest im Backend liegen. Fällt ein Modell-Call aus, kann das Backend notfalls mit den Knoten-Zusammenfassungen aus dem Tree als Fallback-Text weiterspielen — die Runde bricht nie ab.

---

## 8. Technische Grobskizze (nur Kontext)

- **CAP-Backend auf BTP**: Entities für Szenarien, Spieler(-Chroniken), Spielsessions, Tree-Snapshots und Protokolle. Der Tree einer laufenden Runde liegt als JSON am Session-Objekt.
- **WebSockets**: Lobby-Presence, Abstimmungen live, Würfelanimation synchron für alle, Streaming der Erzähltexte. Ein Raum = ein Socket-Channel.
- **AI Core**: Zwei Deployments/Konfigurationen (groß/klein) hinter einer Orchestrierungsschicht im CAP-Service. Strukturierte Ausgaben (JSON-Schema) für Tree und Chronik-Extraktion, freier Text nur für Prosa.
- **Frontend**: Eine simple Browser-App reicht — Lobby-Screen, Story-Screen (Text + Optionen/Würfel/Freitext), Endscreen. Mobile-tauglich, damit es wirklich in der Kaffeeküche am Handy spielbar ist.
- **Spielstand**: Da der Tree fest ist, ist der komplette Spielzustand nur "aktueller Knoten + Protokoll". Rejoin nach Verbindungsabbruch ist trivial.

---

## 9. Beispielrunde (verkürzt)

Szenario "Fluch der Nebelmine", 3 Spieler. Casting: Jana → Unterhändlerin, Tom (Chronik: "packt Probleme mit roher Kraft an") → Schmied mit Vorschlaghammer, Lea (leere Chronik) → junge Kräuterkundige.

1. **Knoten 1 (Gruppenentscheidung)**: Haupteingang oder Lüftungsschacht? → Mehrheit: Schacht.
2. **Knoten 2 (Würfelprobe, Jana)**: Der Schacht führt über einen Abgrund — die KI spielt Janas Höhenangst als Malus ein. Wurf misslingt knapp, die Gruppe muss lärmend abstürzen → alarmierter Zweig.
3. **Knoten 3 (Einzelmoment, Tom)**: Ein Nebelwesen stellt sich in den Weg. Tom tippt: "Ich biete ihm meinen Hammer als Geschenk an." Das kleine Modell mappt das auf die Option *Verhandeln* und erzählt es entsprechend.
4. **Knoten 4 (Würfelprobe, Lea)**: Kräuterprobe gegen die Nebelquelle — Erfolg.
5. **Ende B "Chaotisch entkommen, Quelle versiegelt"**.
6. Chronik-Vorschläge: Tom → "hat einmal einen Geist mit einem Geschenk besänftigt (und seinen Lieblingshammer verloren)" — Tom bestätigt grinsend. Lea → "hat ein Talent für Heilkunde bewiesen". Jana lehnt "Höhenangst hat sich verschlimmert" ab.

Dauer: ~14 Minuten.

---

## 10. Offene Punkte für später

- Szenario-Bibliothek mit Bewertung ("welches Szenario war gut?") für die Kaffeeküchen-Community.
- Saisonale Meta-Ebene: nach X Runden ein "Legenden-Screen" pro Charakter aus dessen Chronik.
- Zuschauermodus für Kolleg:innen ohne Spieler-Slot.
- Schwierigkeitsgrad im Szenario (Würfelschwellen global anheben).
