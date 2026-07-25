#!/usr/bin/env node
/**
 * Smoke-Test: AI-Core-Chronicler end-to-end
 *
 * Führt einen echten Chronicler-Call gegen den konfigurierten AI-Core-Endpunkt aus.
 * Nur sinnvoll wenn AICORE_SERVICE_KEY gesetzt ist.
 *
 * Nutzung:
 *   AICORE_SERVICE_KEY='{"clientid":...}' \
 *   AICORE_DEPLOYMENT_ID=d0a60fa69c65d580 \
 *   node --env-file=.env scripts/smoke-chronicler.mjs
 *
 * Oder mit .env-Datei:
 *   node --env-file=.env scripts/smoke-chronicler.mjs
 */

if (!process.env.AICORE_SERVICE_KEY) {
  console.error('❌ AICORE_SERVICE_KEY nicht gesetzt — Smoke-Test übersprungen.');
  console.error('   Fülle .env basierend auf .env.example und starte mit:');
  console.error('   node --env-file=.env scripts/smoke-chronicler.mjs');
  process.exit(0); // kein Fehler — nur skip
}

// cds.env minimal mocken damit srv/ai/aicore.js konfiguriert ist
process.env.AICORE_DEPLOYMENT_ID = process.env.AICORE_DEPLOYMENT_ID || 'd0a60fa69c65d580';

// Direkt den Plattform-Client testen
const { chat: aiChat } = await import('../srv/ai/aicore.js');

// Und den Game-Adapter testen
const { _runChronicler } = await import('../games/kaffee-kwest/lib/ai-aicore.js');

// ── Test 1: Direkter aiChat-Call ─────────────────────────────────────────────
console.log('\n── Test 1: Direkter aiChat-Call ──');
try {
  const response = await aiChat([
    { role: 'system', content: 'Antworte auf Deutsch in einem Satz.' },
    { role: 'user', content: 'Was ist Kaffee-Kwest in einem Satz?' },
  ], { max_tokens: 100, temperature: 0.5 });
  console.log('✅ aiChat:', response);
} catch (e) {
  console.error('❌ aiChat fehlgeschlagen:', e.message);
  process.exit(1);
}

// ── Test 2: Chronicler mit realistischen Daten ───────────────────────────────
console.log('\n── Test 2: Chronicler (realistisches Spielprotokoll) ──');
const finalState = {
  party: [
    { user: 'alice', isHost: true },
    { user: 'bob' },
  ],
  casting: {
    alice: { role: 'Unterhändler:in des Dorfes', hook: 'redet sich aus allem heraus' },
    bob: { role: 'Schmied:in mit Vorschlaghammer', hook: 'packt Probleme mit roher Kraft an' },
  },
  log: [
    { kind: 'roll', by: 'alice', die: 20, bonus: 0, total: 20, target: 12, success: true },
    { kind: 'moment', by: 'alice', text: 'Ich biete dem Wesen meinen Kaffee als Geschenk an.' },
    { kind: 'roll', by: 'alice', die: 1, bonus: 0, total: 1, target: 10, success: false },
  ],
};

try {
  const entries = await _runChronicler(aiChat, finalState, 'alice');
  console.log(`✅ Chronicler lieferte ${entries.length} Einträge für alice:`);
  entries.forEach((e, i) => console.log(`   ${i + 1}. ${e}`));

  const none = await _runChronicler(aiChat, finalState, 'bob');
  console.log(`✅ Chronicler für bob (keine Einträge erwartet): ${none.length} Einträge`);
} catch (e) {
  console.error('❌ Chronicler fehlgeschlagen:', e.message);
  process.exit(1);
}

console.log('\n✅ Alle Smoke-Tests bestanden.');
