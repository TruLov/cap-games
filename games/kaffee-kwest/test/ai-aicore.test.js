/**
 * Unit tests — lib/ai-aicore.js (Kaffee-Kwest AI-Core-Adapter)
 *
 * Kein echter AI-Core-Call — aiChat wird als Parameter injiziert via _runChronicler.
 * Prüft: Prompt-Aufbau (smoke), Response-Parsing, Kappung, Fehler-Propagation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _runChronicler } from '../lib/ai-aicore.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const party = [
  { symbol: 'X', user: 'alice', isHost: true },
  { symbol: 'O', user: 'bob' },
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
  // alice = 'X' hat keine Einträge → keine AI-Call nötig
  const result = await _runChronicler(failingChat, makeState(log), 'alice');
  assert.deepEqual(result, []);
});

test('parses single-line response into one entry', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true }];
  const result = await _runChronicler(
    mockChat('Hat in einer brenzligen Lage Ruhe bewahrt.'),
    makeState(log), 'alice'
  );
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Hat in einer brenzligen Lage Ruhe bewahrt.');
});

test('parses multi-line response and caps at 2 entries', async () => {
  const log = [{ kind: 'moment', by: 'X', text: 'Ich biete meinen Hammer an!' }];
  const response = 'Erster Eintrag.\nZweiter Eintrag.\nDritter wird ignoriert.';
  const result = await _runChronicler(mockChat(response), makeState(log), 'alice');
  assert.equal(result.length, 2);
  assert.equal(result[0], 'Erster Eintrag.');
  assert.equal(result[1], 'Zweiter Eintrag.');
});

test('filters lines longer than 500 chars', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 1, bonus: 0, total: 1, target: 10, success: false }];
  const response = `${'x'.repeat(501)}\nKurzer gültiger Eintrag.`;
  const result = await _runChronicler(mockChat(response), makeState(log), 'alice');
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Kurzer gültiger Eintrag.');
});

test('returns empty array on empty model response', async () => {
  const log = [{ kind: 'vote', by: 'X', option: 0 }];
  const result = await _runChronicler(mockChat(''), makeState(log), 'alice');
  assert.deepEqual(result, []);
});

test('propagates aiChat error so caller can fall back', async () => {
  const log = [{ kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true }];
  await assert.rejects(
    () => _runChronicler(failingChat, makeState(log), 'alice'),
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
    makeState(log), 'alice'
  );
  assert.ok(Array.isArray(result));
  assert.ok(result.length <= 2);
});

test('ignores whitespace-only lines in response', async () => {
  const log = [{ kind: 'moment', by: 'X', text: 'Etwas mutiges.' }];
  const response = '\n  \nEin echter Eintrag.\n\n  \n';
  const result = await _runChronicler(mockChat(response), makeState(log), 'alice');
  assert.equal(result.length, 1);
  assert.equal(result[0], 'Ein echter Eintrag.');
});
