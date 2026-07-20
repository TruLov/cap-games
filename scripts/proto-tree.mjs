#!/usr/bin/env node
/**
 * Prototyp: AI-Tree-Generierung (Kaffee-Kwest v2 Vorstufe)
 *
 * Testet isoliert (KEIN Spieleingriff), ob gpt-4o-mini aus einer
 * scenario.md-Kurzbeschreibung einen validen, spielbaren Entscheidungsbaum
 * bauen kann — Struktur (schwer) + Prosa/Kohärenz (mittel) in einem Call.
 *
 * Nutzung:
 *   node --env-file=.env scripts/proto-tree.mjs
 *   node --env-file=.env scripts/proto-tree.mjs --runs=5
 *   node --env-file=.env scripts/proto-tree.mjs --scenario=zeitkapsel
 *
 * Output pro Run:
 *   1. Generierter Tree (Prosa lesbar)
 *   2. Validierung (5 Graph-Invarianten)
 *   3. Simulierter Zufallsdurchlauf bis Ending
 * Am Ende: Erfolgsquote + Latenz über alle Runs.
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

const { aiChat } = await import('../srv/ai.js');

// ── CLI-Args ──────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const RUNS = Number(args.runs ?? 3);
const SCENARIO_ID = args.scenario ?? 'nebelmine';

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
        nodes: { type: 'array', items: nodeSchema },
      },
      required: ['start', 'nodes'],
      additionalProperties: false,
    },
  },
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

FELDER JE MECHANIK (übrige Felder auf null setzen):
- mechanic="vote": "options" (2-3 Einträge mit label+next), roll=null, moment=null, ending=null
- mechanic="roll": "roll" (castHint, bonusTag, malusTag, target 8-16, successNext, failNext, successText, failText), options=null, moment=null, ending=null
- mechanic="moment": "moment" (castHint, prompt) + "options" (2-3 Einträge mit label, next, keywords[]), roll=null, ending=null
- mechanic="ending": "ending" (tier, title), text=Schlusstext, options=null, roll=null, moment=null

Ton: ${scenario.tone}. Tabu: ${scenario.taboo}. Ziel-Knotenzahl: ${scenario.length}.
Antworte NUR mit dem JSON-Objekt (kein Markdown, kein Kommentar).`;

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

// ── Ein Run ────────────────────────────────────────────────────────────────────

async function runOnce(scenario, useSchema) {
  const messages = buildMessages(scenario);
  const started = Date.now();

  let raw;
  try {
    raw = await aiChat(messages, {
      max_tokens: 3000,
      temperature: 0.8,
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
  const sim = validation.valid ? simulatePlaythrough(tree) : null;

  return { ok: true, tree, validation, sim, latencyMs };
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
  console.log(`\n═══ Prototyp: AI-Tree-Generierung — Szenario "${SCENARIO_ID}", ${RUNS} Run(s) ═══`);
  const scenario = await loadScenarioDescription(SCENARIO_ID);
  console.log(`\nReferenz (handgeschrieben): ${Object.keys(scenario._reference.nodes).length} Knoten, Start "${scenario._reference.start}"`);

  // Erst prüfen ob response_format:json_schema gegen dieses Deployment funktioniert
  let useSchema = true;
  const schemaProbe = await runOnce(scenario, true);
  if (!schemaProbe.ok && schemaProbe.phase === 'call') {
    console.log(`\n⚠️  response_format:json_schema fehlgeschlagen (${schemaProbe.error}) — Fallback auf Prompt-only-Modus.`);
    useSchema = false;
  }

  const results = [];
  for (let i = 0; i < RUNS; i++) {
    console.log(`\n─── Run ${i + 1}/${RUNS} (Modus: ${useSchema ? 'json_schema' : 'prompt-only'}) ───`);
    const result = i === 0 && schemaProbe.ok ? schemaProbe : await runOnce(scenario, useSchema);
    results.push(result);

    if (!result.ok) {
      console.log(`  ❌ Fehlgeschlagen in Phase "${result.phase}": ${result.error}`);
      if (result.raw) console.log(`  Rohantwort (erste 300 Zeichen): ${result.raw.slice(0, 300)}`);
      continue;
    }

    printTree(result.tree);
    console.log(`\n  Validierung: ${result.validation.valid ? '✅ valide' : '❌ ungültig'} (längster Pfad: ${result.validation.maxDepth})`);
    for (const err of result.validation.errors) console.log(`    - ${err}`);

    if (result.sim) {
      console.log(`\n  Simulierter Durchlauf: ${result.sim.ok ? `✅ ${result.sim.path.length} Szenen → Ending "${result.sim.ending?.title}" (${result.sim.ending?.tier})` : `❌ ${result.sim.reason}`}`);
    }
    console.log(`\n  Latenz: ${result.latencyMs}ms`);
  }

  // Zusammenfassung
  const ok = results.filter(r => r.ok);
  const validCount = ok.filter(r => r.validation?.valid).length;
  const simOkCount = ok.filter(r => r.sim?.ok).length;
  const avgLatency = Math.round(results.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / results.length);

  console.log(`\n═══ Zusammenfassung (${RUNS} Runs, Modus: ${useSchema ? 'json_schema' : 'prompt-only'}) ═══`);
  console.log(`  Parse erfolgreich:     ${ok.length}/${RUNS}`);
  console.log(`  Graph valide:          ${validCount}/${RUNS}`);
  console.log(`  Simulation durchläuft: ${simOkCount}/${RUNS}`);
  console.log(`  Ø Latenz:              ${avgLatency}ms`);
}

await main();
