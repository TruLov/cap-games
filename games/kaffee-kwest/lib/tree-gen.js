/**
 * Kaffee-Kwest — AI-Tree-Generierung (v1.5, produktionsreif aus scripts/proto-tree.mjs).
 *
 * Erzeugt einen kompletten Entscheidungsbaum (Struktur + Prosa) aus einer
 * Szenario-Beschreibung via strukturiertem Modell-Output (json_schema).
 *
 * Pipeline: Generate → Validate → Repair (max. 2 Versuche) → toEngineFormat.
 * Kein CAP-Import, keine I/O außer dem injizierten aiChat — testbar mit
 * gemocktem aiChat, genau wie ai-aicore.js._runChronicler.
 *
 * Kernerkenntnis aus dem Prototyp (games/kaffee-kwest, siehe docs/architecture):
 * Der häufigste Fehler ist referenzielle Inkonsistenz (next/successNext/
 * failNext zeigt auf einen nie angelegten Knoten). Das "nodeIds"-Feld VOR
 * "nodes" im Schema zwingt das Modell, sich zuerst zur vollständigen ID-Menge
 * zu committen, bevor es Kanten schreibt — das behebt ~90-100% der Fälle
 * bereits ohne Repair. Der Repair-Loop bleibt als Sicherheitsnetz für den Rest.
 */

// ── JSON-Schema ───────────────────────────────────────────────────────────────

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

export const treeResponseSchema = {
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
// Kernregel: jede next/successNext/failNext-ID muss als Knoten existieren.

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

export function buildTreeMessages(scenario) {
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

/** Prüft die Graph-Invarianten (nodeIds-Konsistenz + Erreichbarkeit + Sackgassen). Wirft nie. */
export function validateTree(tree) {
  const errors = [];
  const byId = new Map((tree.nodes ?? []).map(n => [n.id, n]));

  if (Array.isArray(tree.nodeIds)) {
    const declared = new Set(tree.nodeIds);
    const actual = new Set(byId.keys());
    for (const id of declared) if (!actual.has(id)) errors.push(`"nodeIds" deklariert "${id}", aber kein Knoten mit dieser id existiert`);
    for (const id of actual) if (!declared.has(id)) errors.push(`Knoten "${id}" existiert, ist aber nicht in "nodeIds" deklariert`);
  }

  if (!tree.start || !byId.has(tree.start))
    errors.push(`start "${tree.start}" existiert nicht in nodes`);

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

  const maxAllowedDepth = 12;
  if (maxDepth > maxAllowedDepth) errors.push(`längster Pfad (${maxDepth}) überschreitet Limit (${maxAllowedDepth})`);

  return { valid: errors.filter(e => !e.includes('nicht fatal')).length === 0, errors, maxDepth };
}

// ── Generate → Validate → Repair ─────────────────────────────────────────────

function buildRepairPrompt(errors) {
  const fatalErrors = errors.filter(e => !e.includes('nicht fatal'));
  return `Dein Baum hat folgende Fehler:
${fatalErrors.map(e => `- ${e}`).join('\n')}

Behebe NUR diese Fehler:
- Für jede fehlende ID: entweder einen passenden Knoten mit dieser ID anlegen, ODER die Referenz auf eine existierende ID umleiten.
- Für Sackgassen: einen ausgehenden Pfad ergänzen (zu einem existierenden Knoten oder einem neuen Ending).

Gib den KOMPLETTEN korrigierten Baum zurück (nicht nur die geänderten Teile).`;
}

/** Ruft aiChat mit dem gegebenen messages-Array auf, parst + validiert die Antwort. */
async function callAndParse(aiChat, messages, temperature) {
  const raw = await aiChat(messages, {
    max_tokens: 3000,
    temperature,
    response_format: treeResponseSchema,
  });

  const jsonText = raw.replace(/^```json\s*|\s*```$/g, '').trim();
  const tree = JSON.parse(jsonText); // wirft bei kaputtem JSON — Aufrufer fängt

  const validation = validateTree(tree);
  return { tree, raw, validation };
}

/**
 * Generate → Validate → Repair (Kontext fortgeführt, max. maxRepairs Versuche).
 * Wirft, wenn der Tree auch nach allen Repair-Versuchen ungültig bleibt, oder
 * bei Call-/Parse-Fehlern — Aufrufer (ai-aicore.js treeBuilder) fällt zurück.
 *
 * @param {Function} aiChat        (messages, opts) => Promise<string>
 * @param {object}    scenario      { title, setting, premise, goal, tone, taboo, length, roles }
 * @param {number}    [maxRepairs=2]
 * @param {number}    [temperature=0.8]
 */
export async function generateTreeWithRepair(aiChat, scenario, maxRepairs = 2, temperature = 0.8) {
  const messages = buildTreeMessages(scenario);
  let result = await callAndParse(aiChat, messages, temperature);
  let repairs = 0;

  while (!result.validation.valid && repairs < maxRepairs) {
    messages.push({ role: 'assistant', content: result.raw });
    messages.push({ role: 'user', content: buildRepairPrompt(result.validation.errors) });
    result = await callAndParse(aiChat, messages, temperature);
    repairs += 1;
  }

  if (!result.validation.valid)
    throw new Error(`AI tree generation failed validation after ${repairs} repair(s): ${result.validation.errors.join('; ')}`);

  return { tree: result.tree, repairs };
}

// ── Übersetzung: Prototyp-Schema → tree.js-Engine-Schema ─────────────────────

/**
 * Konvertiert den AI-generierten Tree (nodes als Array, roll.successNext/
 * failNext) ins Format, das lib/tree.js erwartet (nodes als Objekt, roll.
 * success/fail, moment-Felder auf Knoten-Ebene statt verschachtelt unter
 * "moment"). Wirft nie — liefert immer eine Struktur, Validität wurde bereits
 * von validateTree() geprüft.
 *
 * @param {object} genTree { start, nodeIds, nodes: [...] } (Output von generateTreeWithRepair)
 * @returns {object} { start, nodes: { [id]: node } } (Format für scenario.tree in resolveTree)
 */
export function toEngineFormat(genTree) {
  const nodes = {};
  for (const n of genTree.nodes ?? []) {
    const engineNode = { mechanic: n.mechanic, text: n.text };

    if (n.mechanic === 'vote') {
      engineNode.options = (n.options ?? []).map(o => ({ label: o.label, next: o.next }));
    }
    if (n.mechanic === 'roll' && n.roll) {
      engineNode.roll = {
        castHint: n.roll.castHint,
        bonusTag: n.roll.bonusTag,
        malusTag: n.roll.malusTag,
        target: n.roll.target,
        success: n.roll.successNext,
        fail: n.roll.failNext,
        successText: n.roll.successText,
        failText: n.roll.failText,
      };
    }
    if (n.mechanic === 'moment') {
      engineNode.castHint = n.moment?.castHint;
      engineNode.prompt = n.moment?.prompt;
      engineNode.options = (n.options ?? []).map(o => ({ label: o.label, next: o.next, keywords: o.keywords ?? [] }));
    }
    if (n.mechanic === 'ending' && n.ending) {
      engineNode.ending = { tier: n.ending.tier, title: n.ending.title };
    }

    nodes[n.id] = engineNode;
  }

  return { start: genTree.start, nodes };
}
