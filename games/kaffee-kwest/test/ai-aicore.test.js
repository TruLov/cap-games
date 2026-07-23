/**
 * Unit tests — lib/ai-aicore.js (Kaffee-Kwest AI-Core-Adapter)
 *
 * Kein echter AI-Core-Call — aiChat wird als Parameter injiziert via _runChronicler.
 * Prüft: Prompt-Aufbau (smoke), Response-Parsing, Kappung, Fehler-Propagation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _runChronicler, _runTreeBuilder } from '../lib/ai-aicore.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Players are keyed by their user id; here the ids are X/O for brevity.
const party = [
  { user: 'X', isHost: true },
  { user: 'O' },
];

const casting = {
  X: { role: 'Unterhändler:in des Dorfes', hook: 'redet sich aus allem heraus' },
  O: { role: 'Schmied:in mit Vorschlaghammer', hook: 'packt Probleme mit roher Kraft an' },
};

const makeState = (log = []) => ({ party, casting, log });
const mockChat = (response) => async () => response;
const failingChat = async () => { throw new Error('AI Core unavailable'); };

// ── Tests ─────────────────────────────────────────────────────────────────────

test('returns empty array for unknown user', async () => {
  const result = await _runChronicler(mockChat('Irgendwas.'), makeState(), 'nobody');
  assert.deepEqual(result, []);
});

test('returns empty array when user has no log entries', async () => {
  const log = [{ kind: 'roll', by: 'O', die: 15, bonus: 0, total: 15, target: 12, success: true }];
  // 'X' hat keine Einträge → keine AI-Call nötig
  const result = await _runChronicler(failingChat, makeState(log), 'X');
  assert.deepEqual(result, []);
});

test('parses single-line response into one entry', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true }];
  const result = await _runChronicler(
    mockChat('Hat in einer brenzligen Lage Ruhe bewahrt.'),
    makeState(log), 'X'
  );
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Hat in einer brenzligen Lage Ruhe bewahrt.');
});

test('parses multi-line response and caps at 2 entries', async () => {
  const log = [{ kind: 'moment', by: 'X', text: 'Ich biete meinen Hammer an!' }];
  const response = 'Erster Eintrag.\nZweiter Eintrag.\nDritter wird ignoriert.';
  const result = await _runChronicler(mockChat(response), makeState(log), 'X');
  assert.equal(result.length, 2);
  assert.equal(result[0], 'Erster Eintrag.');
  assert.equal(result[1], 'Zweiter Eintrag.');
});

test('filters lines longer than 500 chars', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 1, bonus: 0, total: 1, target: 10, success: false }];
  const response = `${'x'.repeat(501)}\nKurzer gültiger Eintrag.`;
  const result = await _runChronicler(mockChat(response), makeState(log), 'X');
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Kurzer gültiger Eintrag.');
});

test('returns empty array on empty model response', async () => {
  const log = [{ kind: 'vote', by: 'X', option: 0 }];
  const result = await _runChronicler(mockChat(''), makeState(log), 'X');
  assert.deepEqual(result, []);
});

test('propagates aiChat error so caller can fall back', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true }];
  await assert.rejects(
    () => _runChronicler(failingChat, makeState(log), 'X'),
    /AI Core unavailable/
  );
});

test('handles all log entry types without throwing', async () => {
  const log = [
    { kind: 'roll', by: 'X', die: 12, bonus: 2, total: 14, target: 12, success: true },
    { kind: 'moment', by: 'X', text: 'Ich überrede den Wächter.' },
    { kind: 'vote', by: 'X', option: 1 },
  ];
  const result = await _runChronicler(
    mockChat('Hat geliefert als es darauf ankam.'),
    makeState(log), 'X'
  );
  assert.ok(Array.isArray(result));
  assert.ok(result.length <= 2);
});

test('ignores whitespace-only lines in response', async () => {
  const log = [{ kind: 'moment', by: 'X', text: 'Etwas mutiges.' }];
  const response = '\n  \nEin echter Eintrag.\n\n  \n';
  const result = await _runChronicler(mockChat(response), makeState(log), 'X');
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Ein echter Eintrag.');
});

// ── _runTreeBuilder ───────────────────────────────────────────────────────────

const scenario = {
  ID: 'test-scenario',
  title: 'Testszenario', setting: 'Testort', premise: 'Test', goal: 'Test',
  tone: 'neutral', taboo: 'keins', length: 5,
  roles: [
    { role: 'Held:in', hook: 'mutig', tags: ['mutig', 'stark'] },
    { role: 'Weise:r', hook: 'klug', tags: ['klug', 'weise'] },
  ],
};

/** Ein garantiert valider 4-Knoten-Tree im Prototyp-Schema (Array-nodes). */
function validGenTreeJson() {
  return JSON.stringify({
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
  });
}

test('_runTreeBuilder: builds valid settings from a well-formed AI tree', async () => {
  const treeParty = [
    { user: 'X', isHost: true },
    { user: 'O' },
  ];
  const chat = mockChat(validGenTreeJson());
  const settings = await _runTreeBuilder(chat, { scenario, party: treeParty });

  assert.equal(settings.scenario, 'test-scenario');
  assert.equal(settings.tree.start, 'a');
  assert.ok(!Array.isArray(settings.tree.nodes)); // übersetzt: Objekt, nicht Array
  assert.ok(settings.casting.X);
  assert.ok(settings.casting.O);
  assert.equal(settings.tree.nodes.b.roll.success, 'd'); // successNext -> success übersetzt
});

test('_runTreeBuilder: propagates errors from a persistently invalid AI tree', async () => {
  const treeParty = [
    { user: 'X', isHost: true },
    { user: 'O' },
  ];
  const broken = JSON.parse(validGenTreeJson());
  broken.nodes[0].options[0].next = 'nirgendwo';
  const chat = mockChat(JSON.stringify(broken));
  await assert.rejects(() => _runTreeBuilder(chat, { scenario, party: treeParty }));
});

test('_runTreeBuilder: propagates aiChat errors so caller can fall back', async () => {
  const treeParty = [
    { user: 'X', isHost: true },
    { user: 'O' },
  ];
  await assert.rejects(() => _runTreeBuilder(failingChat, { scenario, party: treeParty }));
});
