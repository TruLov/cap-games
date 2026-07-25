#!/usr/bin/env node
/**
 * Prototyp: AI-Tree-Generierung (Kaffee-Kwest v1.5)
 *
 * WICHTIG: Dieses Skript hat seinen Zweck erfüllt und wurde nach
 * games/kaffee-kwest/lib/tree-gen.js überführt (produktionsreif, verdrahtet
 * in lib/ai-aicore.js treeBuilder). Bleibt als eigenständiges Experimentier-
 * Werkzeug erhalten (z.B. für Modell-Vergleiche via --deployment= o.ä.),
 * ist aber NICHT mehr die Quelle der Wahrheit für den Produktionscode —
 * Änderungen an Schema/Prompt/Validator dort nachziehen, wenn hier verändert.
 *
 * Testet isoliert (KEIN Spieleingriff), ob gpt-4o-mini aus einer
 * scenario.md-Kurzbeschreibung einen validen, spielbaren Entscheidungsbaum
 * bauen kann — Struktur (schwer) + Prosa/Kohärenz (mittel) in einem Call.
 *
 * Nutzung:
 *   node --env-file=.env scripts/proto-tree.mjs
 *   node --env-file=.env scripts/proto-tree.mjs --runs=5
 *   node --env-file=.env scripts/proto-tree.mjs --scenario=zeitkapsel
 *   node --env-file=.env scripts/proto-tree.mjs --repairs=0   (Repair-Loop aus, Baseline messen)
 *   node --env-file=.env scripts/proto-tree.mjs --repairs=3   (mehr Repair-Versuche)
 *   node --env-file=.env scripts/proto-tree.mjs --temp=0.4    (Struktur-Disziplin, Default 0.8)
 *
 * Generate → Validate → Repair: bei ungültigem Tree wird die kaputte Antwort
 * + eine gezielte Fehlerkorrektur an dasselbe Gespräch angehängt (Kontext
 * fortgeführt) — das Modell sieht seinen eigenen Fehler und korrigiert ihn.
 * Max. Repair-Versuche via --repairs= (Default 2).
 *
 * Output pro Run:
 *   1. Generierter Tree (Prosa lesbar)
 *   2. Validierung (5 Graph-Invarianten) + genutzte Repair-Runden
 *   3. Simulierter Zufallsdurchlauf bis Ending
 * Am Ende: sofort/nach-Repair/gescheitert-Quote + Ø Repair-Runden + Latenz.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.AICORE_SERVICE_KEY) {
  console.error('❌ AICORE_SERVICE_KEY nicht gesetzt.');
  console.error('   node --env-file=.env scripts/proto-tree.mjs');
  process.exit(0);
}
process.env.AICORE_DEPLOYMENT_ID = process.env.AICORE_DEPLOYMENT_ID || 'd0a60fa69c65d580';

const { chat: aiChat } = await import('../srv/ai/aicore.js');

// ── CLI-Args ──────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const RUNS = Number(args.runs ?? 3);
const SCENARIO_ID = args.scenario ?? 'nebelmine';
const MAX_REPAIRS = Number(args.repairs ?? 2);
const TEMPERATURE = Number(args.temp ?? 0.8);

// ── Szenario-Input laden (nur die scenario.md-Felder, OHNE tree) ────────────

async function loadScenarioDescription(id) {
  const raw = JSON.parse(await readFile(join(__dirname, '..', 'games', 'kaffee-kwest', 'db', 'data', `${id}.json`), 'utf8'));
  const { title, setting, premise, goal, tone, taboo, length, roles } = raw;
  return { title, setting, premise, goal, tone, taboo, length, roles, _reference: raw.tree };
}

// ── JSON-Schema für den generierten Tree ─────────────────────────────────────
// Flache Node-Struktur, optionale Felder als [Typ, null] (OpenAI strict-mode
// Konvention: alle Properties müssen in `required` stehen, Absenz via null).

const optionSchema = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    next: { type: 'string', description: 'ID eines existierenden Knotens' },
    keywords: {
      anyOf: [
        { type: 'array', items: { type: 'string' } },
        { type: 'null' },
      ],
      description: 'nur für moment-Knoten: Schlüsselwörter zur Freitext-Klassifikation',
    },
  },
  required: ['label', 'next', 'keywords'],
  additionalProperties: false,
};

const rollSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        castHint: { type: 'string', description: 'Tag zur Akteur-Auswahl, z.B. "klettern"' },
        bonusTag: { type: 'string' },
        malusTag: { type: 'string' },
        target: { type: 'integer', minimum: 8, maximum: 16 },
        successNext: { type: 'string' },
        failNext: { type: 'string' },
        successText: { type: 'string' },
        failText: { type: 'string' },
      },
      required: ['castHint', 'bonusTag', 'malusTag', 'target', 'successNext', 'failNext', 'successText', 'failText'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const momentSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        castHint: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['castHint', 'prompt'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const endingSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['good', 'mixed', 'bad'] },
        title: { type: 'string' },
      },
      required: ['tier', 'title'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
};

const nodeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    mechanic: { type: 'string', enum: ['vote', 'roll', 'moment', 'ending'] },
    text: { type: 'string', description: '2-3 Sätze Prosa' },
    options: {
      anyOf: [
        { type: 'array', items: optionSchema },
        { type: 'null' },
      ],
      description: 'für vote/moment: 2-3 Optionen; sonst null',
    },
    roll: rollSchema,
    moment: momentSchema,
    ending: endingSchema,
  },
  required: ['id', 'mechanic', 'text', 'options', 'roll', 'moment', 'ending'],
  additionalProperties: false,
};

const treeResponseSchema = {
  type: 'json_schema',
  json_schema: {
    name: 'decision_tree',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'ID des Startknotens' },
        nodeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'VOLLSTÄNDIGE Liste aller Knoten-IDs, die du gleich anlegen wirst — committe dich hier zuerst zur ID-Menge, bevor du next/successNext/failNext-Referenzen schreibst.',
        },
        nodes: { type: 'array', items: nodeSchema },
      },
      required: ['start', 'nodeIds', 'nodes'],
      additionalProperties: false,
    },
  },
};

// ── Few-Shot-Beispiel ─────────────────────────────────────────────────────────
// Handgebautes, garantiert valides Mini-Beispiel (4 Knoten) — demonstriert die
// Kernregel, an der gpt-4o-mini am häufigsten scheitert: jede next/successNext/
// failNext-ID muss als Knoten existieren. Bewusst klein (Tokens sparen), deckt
// vote+roll+2 endings ab (moment folgt demselben next-Muster wie vote).

const FEW_SHOT_EXAMPLE = {
  start: 'lagerfeuer',
  nodeIds: ['lagerfeuer', 'wald', 'warten', 'entdeckung', 'flucht'],
  nodes: [
    {
      id: 'lagerfeuer',
      mechanic: 'vote',
      text: 'Die Gruppe sitzt am Lagerfeuer. Ein Geräusch aus dem Wald lässt alle aufschrecken.',
      options: [
        { label: 'Nachsehen gehen', next: 'wald', keywords: null },
        { label: 'Ruhig bleiben und abwarten', next: 'warten', keywords: null },
      ],
      roll: null, moment: null, ending: null,
    },
    {
      id: 'wald',
      mechanic: 'roll',
      text: 'Im Wald ist es stockdunkel. Ein Ast knackt unter deinem Fuß.',
      options: null,
      roll: {
        castHint: 'mutig', bonusTag: 'stark', malusTag: 'ängstlich', target: 12,
        successNext: 'entdeckung', failNext: 'flucht',
        successText: 'Du findest die Quelle des Geräuschs — nur ein Reh.',
        failText: 'Du erschrickst und rennst zurück.',
      },
      moment: null, ending: null,
    },
    {
      id: 'warten',
      mechanic: 'vote',
      text: 'Die Gruppe bleibt sitzen. Das Geräusch verstummt langsam.',
      options: [{ label: 'Weiter warten', next: 'entdeckung', keywords: null }],
      roll: null, moment: null, ending: null,
    },
    {
      id: 'entdeckung',
      mechanic: 'ending',
      text: 'Alles war harmlos. Ihr genießt den Rest des Abends am Feuer.',
      options: null, roll: null, moment: null,
      ending: { tier: 'good', title: 'Ruhiger Abend' },
    },
    {
      id: 'flucht',
      mechanic: 'ending',
      text: 'Ihr flieht panisch zurück ins Lager — ohne Erklärung, aber sicher.',
      options: null, roll: null, moment: null,
      ending: { tier: 'mixed', title: 'Panische Flucht' },
    },
  ],
};

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildMessages(scenario) {
  const rolesText = scenario.roles.map(r => `- ${r.role} (Haken: ${r.hook}, Tags: ${r.tags.join(', ')})`).join('\n');

  const system = `Du baust einen festen Entscheidungsbaum für ein kooperatives Kaffeepausen-Abenteuer (<20 Minuten).

HARTE REGELN (Graph-Integrität — Verstoß macht das Spiel unspielbar):
1. Jeder Knoten hat eine eindeutige "id" (kurzer String, z.B. "eingang", "wesen").
2. "start" muss die id eines existierenden Knotens sein.
3. JEDE Referenz (option.next, roll.successNext, roll.failNext) MUSS die id eines Knotens sein, der auch in "nodes" existiert. Keine erfundenen IDs.
4. Mindestens 1, idealerweise 2-3 Knoten mit mechanic="ending" (tier: good/mixed/bad) müssen vom Start aus erreichbar sein.
5. JEDER Nicht-ending-Knoten braucht mindestens einen ausgehenden Pfad (keine Sackgassen).
6. Die Gesamtlänge (längster Pfad vom Start zu einem Ending) darf ${scenario.length + 2} Knoten nicht überschreiten (Zeitlimit).
7. Mechaniken abwechseln: nicht mehr als 2 gleiche Mechaniken hintereinander.

WICHTIG — Reihenfolge zur Vermeidung toter Referenzen:
Das Feld "nodeIds" kommt VOR "nodes" in deiner Antwort. Committe dich dort zuerst
zur VOLLSTÄNDIGEN Liste aller Knoten-IDs, die du gleich anlegen wirst — bevor du
irgendeine next/successNext/failNext-Referenz schreibst. Jede ID, die du in
next/successNext/failNext verwendest, MUSS bereits in "nodeIds" stehen, UND jede
ID in "nodeIds" MUSS später auch als echter Knoten in "nodes" auftauchen. Erfinde
keine ID in einer Referenz, die nicht vorher in "nodeIds" deklariert wurde.

FELDER JE MECHANIK (übrige Felder auf null setzen):
- mechanic="vote": "options" (2-3 Einträge mit label+next), roll=null, moment=null, ending=null
- mechanic="roll": "roll" (castHint, bonusTag, malusTag, target 8-16, successNext, failNext, successText, failText), options=null, moment=null, ending=null
- mechanic="moment": "moment" (castHint, prompt) + "options" (2-3 Einträge mit label, next, keywords[]), roll=null, ending=null
- mechanic="ending": "ending" (tier, title), text=Schlusstext, options=null, roll=null, moment=null

BEISPIEL für Format + referenzielle Konsistenz (baue einen ANDEREN, größeren Baum für das echte Szenario unten — dies ist nur ein Muster, nicht zu kopieren):
${JSON.stringify(FEW_SHOT_EXAMPLE, null, 2)}

Beachte: JEDE next/successNext/failNext-ID im Beispiel oben (wald, warten, entdeckung, flucht) existiert auch als eigener Knoten in "nodes". Genau dieses Muster musst du für deinen eigenen, größeren Baum einhalten.

Prüfe vor der Antwort: stimmt "nodeIds" exakt mit den IDs aller Knoten in "nodes" überein, und existiert jede in next/successNext/failNext genannte ID in "nodeIds"?

Ton: ${scenario.tone}. Tabu: ${scenario.taboo}. Ziel-Knotenzahl: ${scenario.length}.`;

  const user = `Szenario: ${scenario.title}
Setting: ${scenario.setting}
Prämisse: ${scenario.premise}
Ziel: ${scenario.goal}

Verfügbare Rollen (castHint sollte zu einem der Tags passen):
${rolesText}

Baue den kompletten Entscheidungsbaum.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ── Validator ─────────────────────────────────────────────────────────────────

/** Prüft die 5 Graph-Invarianten. Wirft nie — gibt { valid, errors[] } zurück. */
function validateTree(tree) {
  const errors = [];
  const byId = new Map((tree.nodes ?? []).map(n => [n.id, n]));

  // 0. nodeIds-Konsistenz (A1: Selbst-Deklaration muss mit den echten Knoten übereinstimmen)
  if (Array.isArray(tree.nodeIds)) {
    const declared = new Set(tree.nodeIds);
    const actual = new Set(byId.keys());
    for (const id of declared) if (!actual.has(id)) errors.push(`"nodeIds" deklariert "${id}", aber kein Knoten mit dieser id existiert`);
    for (const id of actual) if (!declared.has(id)) errors.push(`Knoten "${id}" existiert, ist aber nicht in "nodeIds" deklariert`);
  }

  // 1. start existiert
  if (!tree.start || !byId.has(tree.start))
    errors.push(`start "${tree.start}" existiert nicht in nodes`);

  // 2. alle Referenzen auflösbar
  const refs = [];
  for (const n of tree.nodes ?? []) {
    if (n.options) for (const o of n.options) if (o.next) refs.push([n.id, o.next]);
    if (n.roll) {
      if (n.roll.successNext) refs.push([n.id, n.roll.successNext]);
      if (n.roll.failNext) refs.push([n.id, n.roll.failNext]);
    }
  }
  for (const [from, to] of refs)
    if (!byId.has(to)) errors.push(`Knoten "${from}" referenziert unbekannten Knoten "${to}"`);

  // 3+4+5: BFS vom Start — Erreichbarkeit, Sackgassen, Pfadlänge
  let endingReachable = false;
  let maxDepth = 0;
  const visited = new Set();
  if (tree.start && byId.has(tree.start)) {
    const queue = [[tree.start, 0]];
    visited.add(tree.start);
    while (queue.length) {
      const [id, depth] = queue.shift();
      maxDepth = Math.max(maxDepth, depth);
      const n = byId.get(id);
      if (!n) continue;

      if (n.mechanic === 'ending') { endingReachable = true; continue; }

      const outgoing = [];
      if (n.options) for (const o of n.options) if (o.next && byId.has(o.next)) outgoing.push(o.next);
      if (n.roll) {
        if (n.roll.successNext && byId.has(n.roll.successNext)) outgoing.push(n.roll.successNext);
        if (n.roll.failNext && byId.has(n.roll.failNext)) outgoing.push(n.roll.failNext);
      }

      if (outgoing.length === 0)
        errors.push(`Knoten "${id}" ist eine Sackgasse (kein Ending, kein Ausgang)`);

      for (const next of outgoing) {
        if (!visited.has(next)) { visited.add(next); queue.push([next, depth + 1]); }
      }
    }
  }
  if (!endingReachable) errors.push('kein "ending"-Knoten vom Start aus erreichbar');

  const unreachable = [...byId.keys()].filter(id => !visited.has(id));
  if (unreachable.length) errors.push(`unerreichbare Knoten (nicht fatal): ${unreachable.join(', ')}`);

  const maxAllowedDepth = 12; // grobzügige Obergrenze, echte Längenprüfung ist scenario-spezifisch im Prompt
  if (maxDepth > maxAllowedDepth) errors.push(`längster Pfad (${maxDepth}) überschreitet Limit (${maxAllowedDepth})`);

  return { valid: errors.filter(e => !e.includes('nicht fatal')).length === 0, errors, maxDepth };
}

// ── Ein Modell-Call (Generierung ODER Repair, gleiche Mechanik) ─────────────

/** Ruft aiChat mit dem gegebenen messages-Array auf, parst + validiert die Antwort. */
async function callAndParse(messages, useSchema, temperature = TEMPERATURE) {
  const started = Date.now();
  let raw;
  try {
    raw = await aiChat(messages, {
      max_tokens: 3000,
      temperature,
      ...(useSchema ? { response_format: treeResponseSchema } : {}),
    });
  } catch (e) {
    return { ok: false, phase: 'call', error: e.message, latencyMs: Date.now() - started };
  }
  const latencyMs = Date.now() - started;

  let tree;
  try {
    // robustes Parsing auch ohne Schema (falls Modell Markdown-Fences anhängt)
    const jsonText = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    tree = JSON.parse(jsonText);
  } catch (e) {
    return { ok: false, phase: 'parse', error: e.message, raw, latencyMs };
  }

  const validation = validateTree(tree);
  return { ok: true, tree, raw, validation, latencyMs };
}

/** Baut die Repair-Anweisung aus den konkreten Validator-Fehlern (ohne "nicht fatal"-Warnungen). */
function buildRepairPrompt(errors) {
  const fatalErrors = errors.filter(e => !e.includes('nicht fatal'));
  return `Dein Baum hat folgende Fehler:
${fatalErrors.map(e => `- ${e}`).join('\n')}

Behebe NUR diese Fehler:
- Für jede fehlende ID: entweder einen passenden Knoten mit dieser ID anlegen, ODER die Referenz auf eine existierende ID umleiten.
- Für Sackgassen: einen ausgehenden Pfad ergänzen (zu einem existierenden Knoten oder einem neuen Ending).

Gib den KOMPLETTEN korrigierten Baum zurück (nicht nur die geänderten Teile).`;
}

/**
 * Generate → Validate → Repair (Kontext fortgeführt): bei ungültigem Tree
 * wird die kaputte Antwort + eine gezielte Fehlerkorrektur an dasselbe
 * messages-Array angehängt (Option A — Modell sieht seinen eigenen Fehler).
 */
async function generateWithRepair(scenario, useSchema, maxRepairs) {
  const messages = buildMessages(scenario);
  let result = await callAndParse(messages, useSchema);
  let repairs = 0;
  let totalLatencyMs = result.latencyMs ?? 0;

  while (result.ok && !result.validation.valid && repairs < maxRepairs) {
    messages.push({ role: 'assistant', content: result.raw });
    messages.push({ role: 'user', content: buildRepairPrompt(result.validation.errors) });

    const repaired = await callAndParse(messages, useSchema);
    totalLatencyMs += repaired.latencyMs ?? 0;
    repairs += 1;

    if (!repaired.ok) {
      // Repair-Call selbst gescheitert (Netzwerk/Parse) — vorherigen Zustand behalten, Loop beenden
      break;
    }
    result = repaired;
  }

  return { ...result, repairs, latencyMs: totalLatencyMs };
}

// ── Simulierter Zufallsdurchlauf ─────────────────────────────────────────────

function simulatePlaythrough(tree, maxSteps = 20) {
  const byId = new Map((tree.nodes ?? []).map(n => [n.id, n]));
  const path = [];
  let current = tree.start;
  for (let step = 0; step < maxSteps; step++) {
    const n = byId.get(current);
    if (!n) return { ok: false, reason: `Knoten "${current}" nicht gefunden`, path };
    path.push({ id: current, mechanic: n.mechanic });

    if (n.mechanic === 'ending') return { ok: true, path, ending: n.ending };

    let next;
    if (n.mechanic === 'vote' || n.mechanic === 'moment') {
      const opts = (n.options ?? []).filter(o => o.next);
      if (!opts.length) return { ok: false, reason: `Knoten "${current}" hat keine gültigen Optionen`, path };
      next = opts[Math.floor(Math.random() * opts.length)].next;
    } else if (n.mechanic === 'roll') {
      const success = Math.random() < 0.5;
      next = success ? n.roll?.successNext : n.roll?.failNext;
      if (!next) return { ok: false, reason: `Knoten "${current}" (roll) hat kein ${success ? 'successNext' : 'failNext'}`, path };
    } else {
      return { ok: false, reason: `unbekannte mechanic "${n.mechanic}"`, path };
    }
    current = next;
  }
  return { ok: false, reason: `Endlosschleife — ${maxSteps} Schritte ohne Ending`, path };
}

// ── Report ────────────────────────────────────────────────────────────────────

function printTree(tree) {
  console.log(`\n  Titel: ${tree.title ?? '(kein Titel im Output)'}  |  Start: ${tree.start}  |  ${tree.nodes?.length ?? 0} Knoten`);
  for (const n of tree.nodes ?? []) {
    console.log(`\n  [${n.id}] (${n.mechanic})`);
    console.log(`    ${n.text}`);
    if (n.options) for (const o of n.options) console.log(`    → "${o.label}" → ${o.next}`);
    if (n.roll) console.log(`    🎲 Ziel ${n.roll.target} (${n.roll.castHint}) → ✅${n.roll.successNext} / ❌${n.roll.failNext}`);
    if (n.moment) console.log(`    💬 ${n.moment.prompt} (${n.moment.castHint})`);
    if (n.ending) console.log(`    🏁 [${n.ending.tier}] ${n.ending.title}`);
  }
}

async function main() {
  console.log(`\n═══ Prototyp: AI-Tree-Generierung — Szenario "${SCENARIO_ID}", ${RUNS} Run(s), max ${MAX_REPAIRS} Repair(s), temp=${TEMPERATURE} ═══`);
  const scenario = await loadScenarioDescription(SCENARIO_ID);
  console.log(`\nReferenz (handgeschrieben): ${Object.keys(scenario._reference.nodes).length} Knoten, Start "${scenario._reference.start}"`);

  // Erst prüfen ob response_format:json_schema gegen dieses Deployment funktioniert
  let useSchema = true;
  const schemaProbe = await callAndParse(buildMessages(scenario), true);
  if (!schemaProbe.ok && schemaProbe.phase === 'call') {
    console.log(`\n⚠️  response_format:json_schema fehlgeschlagen (${schemaProbe.error}) — Fallback auf Prompt-only-Modus.`);
    useSchema = false;
  }

  const results = [];
  for (let i = 0; i < RUNS; i++) {
    console.log(`\n─── Run ${i + 1}/${RUNS} (Modus: ${useSchema ? 'json_schema' : 'prompt-only'}) ───`);
    const result = await generateWithRepair(scenario, useSchema, MAX_REPAIRS);
    results.push(result);

    if (!result.ok) {
      console.log(`  ❌ Fehlgeschlagen in Phase "${result.phase}": ${result.error}`);
      if (result.raw) console.log(`  Rohantwort (erste 300 Zeichen): ${result.raw.slice(0, 300)}`);
      continue;
    }

    printTree(result.tree);
    console.log(`\n  Validierung: ${result.validation.valid ? '✅ valide' : '❌ ungültig'} (längster Pfad: ${result.validation.maxDepth}, ${result.repairs} Repair(s) genutzt)`);
    for (const err of result.validation.errors) console.log(`    - ${err}`);

    const sim = result.validation.valid ? simulatePlaythrough(result.tree) : null;
    if (sim) {
      console.log(`\n  Simulierter Durchlauf: ${sim.ok ? `✅ ${sim.path.length} Szenen → Ending "${sim.ending?.title}" (${sim.ending?.tier})` : `❌ ${sim.reason}`}`);
    }
    result.sim = sim;
    console.log(`\n  Latenz (inkl. Repairs): ${result.latencyMs}ms`);
  }

  // Zusammenfassung
  const ok = results.filter(r => r.ok);
  const validImmediately = ok.filter(r => r.validation?.valid && r.repairs === 0).length;
  const validAfterRepair = ok.filter(r => r.validation?.valid && r.repairs > 0).length;
  const failedFinal = ok.filter(r => !r.validation?.valid).length;
  const simOkCount = ok.filter(r => r.sim?.ok).length;
  const avgRepairs = ok.length ? (ok.reduce((s, r) => s + (r.repairs ?? 0), 0) / ok.length).toFixed(1) : '—';
  const avgLatency = Math.round(results.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / results.length);

  console.log(`\n═══ Zusammenfassung (${RUNS} Runs, Modus: ${useSchema ? 'json_schema' : 'prompt-only'}, max ${MAX_REPAIRS} Repair(s)) ═══`);
  console.log(`  Parse erfolgreich:      ${ok.length}/${RUNS}`);
  console.log(`  Sofort valide:          ${validImmediately}/${RUNS}`);
  console.log(`  Nach Repair valide:     ${validAfterRepair}/${RUNS}`);
  console.log(`  Insgesamt valide:       ${validImmediately + validAfterRepair}/${RUNS}`);
  console.log(`  Endgültig gescheitert:  ${failedFinal}/${RUNS}`);
  console.log(`  Simulation durchläuft:  ${simOkCount}/${RUNS}`);
  console.log(`  Ø Repair-Runden:        ${avgRepairs}`);
  console.log(`  Ø Latenz (inkl. Repairs): ${avgLatency}ms`);
}

await main();
