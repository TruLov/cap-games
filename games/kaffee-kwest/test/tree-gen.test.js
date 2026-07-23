/**
 * Unit tests — lib/tree-gen.js (AI-Tree-Generierung, v1.5)
 *
 * Kein echter AI-Core-Call — aiChat wird als Parameter injiziert.
 * Prüft: Validator-Invarianten, Prototyp→Engine-Übersetzung, Repair-Loop,
 * und (kritisch) dass ein übersetzter Tree wirklich durch die echte
 * tree.js-Engine läuft (init + ein Zug).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTree,
  toEngineFormat,
  generateTreeWithRepair,
  buildTreeMessages,
} from '../lib/tree-gen.js';
import { resolveTree, castParty } from '../lib/ai-static.js';
import * as tree from '../lib/tree.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const scenario = {
  title: 'Testszenario', setting: 'Testort', premise: 'Test', goal: 'Test',
  tone: 'neutral', taboo: 'keins', length: 5,
  roles: [
    { role: 'Held:in', hook: 'mutig', tags: ['mutig', 'stark'] },
    { role: 'Weise:r', hook: 'klug', tags: ['klug', 'weise'] },
  ],
};

/** Ein garantiert valider 4-Knoten-Tree im Prototyp-Schema (Array-nodes). */
function validGenTree() {
  return {
    start: 'a',
    nodeIds: ['a', 'b', 'c', 'd'],
    nodes: [
      {
        id: 'a', mechanic: 'vote', text: 'Szene A.',
        options: [{ label: 'links', next: 'b', keywords: null }, { label: 'rechts', next: 'c', keywords: null }],
        roll: null, moment: null, ending: null,
      },
      {
        id: 'b', mechanic: 'roll', text: 'Szene B.', options: null,
        roll: {
          castHint: 'mutig', bonusTag: 'stark', malusTag: 'schwach', target: 10,
          successNext: 'd', failNext: 'c', successText: 'Erfolg!', failText: 'Fehlschlag!',
        },
        moment: null, ending: null,
      },
      {
        id: 'c', mechanic: 'ending', text: 'Schlecht gelaufen.', options: null, roll: null, moment: null,
        ending: { tier: 'bad', title: 'Ende C' },
      },
      {
        id: 'd', mechanic: 'ending', text: 'Gut gelaufen.', options: null, roll: null, moment: null,
        ending: { tier: 'good', title: 'Ende D' },
      },
    ],
  };
}

const mockChat = (response) => async () => response;
const failingChat = async () => { throw new Error('AI Core unavailable'); };

// ── buildTreeMessages ──────────────────────────────────────────────────────────

test('buildTreeMessages: includes scenario fields and few-shot example', () => {
  const messages = buildTreeMessages(scenario);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages[0].content.includes('nodeIds'));
  assert.ok(messages[1].content.includes(scenario.title));
  assert.ok(messages[1].content.includes('Held:in'));
});

// ── validateTree ──────────────────────────────────────────────────────────────

test('validateTree: accepts a well-formed tree', () => {
  const result = validateTree(validGenTree());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validateTree: rejects a tree with a dangling reference', () => {
  const broken = validGenTree();
  broken.nodes[0].options[0].next = 'nirgendwo';
  const result = validateTree(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('nirgendwo')));
});

test('validateTree: rejects when nodeIds does not match actual nodes', () => {
  const broken = validGenTree();
  broken.nodeIds.push('geistknoten');
  const result = validateTree(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('geistknoten')));
});

test('validateTree: rejects unreachable start', () => {
  const broken = validGenTree();
  broken.start = 'nirgendwo';
  const result = validateTree(broken);
  assert.equal(result.valid, false);
});

test('validateTree: rejects a dead end (non-ending node with no outgoing path)', () => {
  const broken = validGenTree();
  broken.nodes[0].options[0].next = 'a'; // links -> self (unreachable others still fine)
  broken.nodes[0].options[1].next = 'a'; // beide zeigen auf sich selbst -> b,c,d unreachable, aber nicht "dead end" für a selbst da a einen Ausgang hat (auf sich selbst)
  // baue stattdessen einen echten dead end: ein neuer Knoten ohne outgoing
  broken.nodeIds.push('sackgasse');
  broken.nodes.push({ id: 'sackgasse', mechanic: 'vote', text: 'x', options: [], roll: null, moment: null, ending: null });
  broken.nodes[0].options[0].next = 'sackgasse';
  const result = validateTree(broken);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('Sackgasse')));
});

// ── toEngineFormat ────────────────────────────────────────────────────────────

test('toEngineFormat: converts nodes array to keyed object', () => {
  const engine = toEngineFormat(validGenTree());
  assert.equal(engine.start, 'a');
  assert.equal(typeof engine.nodes, 'object');
  assert.ok(!Array.isArray(engine.nodes));
  assert.deepEqual(Object.keys(engine.nodes).sort(), ['a', 'b', 'c', 'd']);
});

test('toEngineFormat: maps roll.successNext/failNext to roll.success/fail', () => {
  const engine = toEngineFormat(validGenTree());
  assert.equal(engine.nodes.b.roll.success, 'd');
  assert.equal(engine.nodes.b.roll.fail, 'c');
  assert.equal(engine.nodes.b.roll.successNext, undefined);
  assert.equal(engine.nodes.b.roll.target, 10);
});

test('toEngineFormat: preserves vote options as label/next pairs', () => {
  const engine = toEngineFormat(validGenTree());
  assert.deepEqual(engine.nodes.a.options, [
    { label: 'links', next: 'b' },
    { label: 'rechts', next: 'c' },
  ]);
});

test('toEngineFormat: ending nodes carry tier/title', () => {
  const engine = toEngineFormat(validGenTree());
  assert.deepEqual(engine.nodes.d.ending, { tier: 'good', title: 'Ende D' });
});

test('toEngineFormat: moment nodes hoist castHint/prompt to node level', () => {
  const genTree = validGenTree();
  genTree.nodes[0] = {
    id: 'a', mechanic: 'moment', text: 'Was tust du?',
    options: [{ label: 'reden', next: 'b', keywords: ['hallo', 'reden'] }],
    roll: null, moment: { castHint: 'diplomat', prompt: 'Sag was!' }, ending: null,
  };
  const engine = toEngineFormat(genTree);
  assert.equal(engine.nodes.a.castHint, 'diplomat');
  assert.equal(engine.nodes.a.prompt, 'Sag was!');
  assert.deepEqual(engine.nodes.a.options[0].keywords, ['hallo', 'reden']);
});

// ── generateTreeWithRepair ────────────────────────────────────────────────────

test('generateTreeWithRepair: returns immediately when first response is valid', async () => {
  const chat = mockChat(JSON.stringify(validGenTree()));
  const { tree: result, repairs } = await generateTreeWithRepair(chat, scenario);
  assert.equal(repairs, 0);
  assert.equal(result.start, 'a');
});

test('generateTreeWithRepair: repairs an invalid tree using the follow-up response', async () => {
  const broken = validGenTree();
  broken.nodes[0].options[0].next = 'nirgendwo'; // kaputt
  let callCount = 0;
  const chat = async () => {
    callCount += 1;
    return JSON.stringify(callCount === 1 ? broken : validGenTree());
  };
  const { tree: result, repairs } = await generateTreeWithRepair(chat, scenario, 2);
  assert.equal(repairs, 1);
  assert.equal(callCount, 2);
  assert.equal(validateTree(result).valid, true);
});

test('generateTreeWithRepair: throws after exhausting repairs on a persistently broken tree', async () => {
  const broken = validGenTree();
  broken.nodes[0].options[0].next = 'nirgendwo';
  const chat = mockChat(JSON.stringify(broken)); // immer kaputt
  await assert.rejects(
    () => generateTreeWithRepair(chat, scenario, 2),
    /validation/
  );
});

test('generateTreeWithRepair: propagates call errors', async () => {
  await assert.rejects(() => generateTreeWithRepair(failingChat, scenario), /AI Core unavailable/);
});

test('generateTreeWithRepair: propagates parse errors', async () => {
  await assert.rejects(() => generateTreeWithRepair(mockChat('not json'), scenario, 0));
});

// ── Kritischer Test: übersetzter AI-Tree läuft durch die ECHTE Engine ──────────

test('a generated + translated tree actually plays through the real tree.js engine', () => {
  const engineTree = toEngineFormat(validGenTree());
  const party = [
    { user: 'X', isHost: true },
    { user: 'O' },
  ];
  // wie in _runTreeBuilder: Casting + Actor-/Bonus-Auflösung VOR init()
  const texts = { X: 'mutig stark', O: 'klug weise' };
  const casting = castParty(scenario.roles, party, texts);
  const resolvedTree = resolveTree(engineTree, party, casting, texts);

  const settings = {
    party,
    casting,
    tree: resolvedTree,
    sceneTotal: 4,
    seed: 42,
  };

  const state = tree.init(settings);
  assert.equal(state.nodeId, 'a');
  assert.equal(state.phase, 'playing');

  // vote-Knoten a: beide Spieler wählen "links" -> b
  let result = tree.applyMove(state, { type: 'vote', option: 0 }, 'X');
  result = tree.applyMove(result.state, { type: 'vote', option: 0 }, 'O');
  assert.equal(result.state.nodeId, 'b');
  assert.equal(result.end, null);

  // roll-Knoten b: Actor wurde bereits von resolveTree aufgelöst
  const rollActor = result.state.tree.nodes.b.roll.symbol;
  assert.ok(['X', 'O'].includes(rollActor));
  const rolled = tree.applyMove(result.state, { type: 'roll' }, rollActor);
  assert.ok(rolled.state.nodeId === 'c' || rolled.state.nodeId === 'd');
  assert.ok(rolled.end !== null); // beide Ziele (c, d) sind ending-Knoten
  assert.equal(rolled.end.winner, 'draw');
  assert.ok(['good', 'bad'].includes(rolled.end.ending.tier));
});
