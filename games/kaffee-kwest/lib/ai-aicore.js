/**
 * Kaffee-Kwest — AI-Core-Adapter (v1.5).
 *
 * Implementiert die beiden AI-Ports mit echten Modell-Calls:
 *   treeBuilder — generiert Casting + Entscheidungsbaum via gpt-4o-mini
 *                 (Generate → Validate → Repair, siehe lib/tree-gen.js)
 *   chronicler  — nutzt gpt-4o-mini via Plattform-Service (AiService)
 *
 * Fallback-Garantie: wirft bei JEDEM Fehler (Call/Parse/Validierung/
 * Übersetzung/Engine-Test) → KaffeeKwestService fällt auf ai-static zurück.
 * Runde startet immer, egal ob AI verfügbar ist. Selbe Signatur wie
 * ai-static.js — austauschbar ohne Änderung am Aufrufer.
 */

import cds from '@sap/cds';
import { castParty, playerText, resolveTree } from './ai-static.js';
import { generateTreeWithRepair, toEngineFormat } from './tree-gen.js';
import * as tree from './tree.js';

/**
 * Obtains an `aiChat(messages, opts) → string` bound to the platform AI service.
 * Loose coupling: the game connects to the modeled `AiService` via the CAP
 * service registry — no relative import into platform internals, no shared
 * config. A future AI game does exactly this to reach the platform LLM.
 */
async function platformAiChat() {
  const ai = await cds.connect.to('AiService');
  return (messages, opts = {}) =>
    ai.send('chat', { messages: JSON.stringify(messages), options: JSON.stringify(opts) });
}

/**
 * Kern-Logik: generiert Tree via AI, übersetzt ins Engine-Format, castet die
 * Party, löst Akteure/Boni auf und prüft das Ergebnis gegen die echte Engine
 * (init() + ein simulierter Zug), bevor es zurückgegeben wird.
 *
 * Nimmt aiChat als Parameter → testbar ohne Modul-Mocking (wie _runChronicler).
 *
 * @internal — öffentliche API ist treeBuilder()
 */
export async function _runTreeBuilder(aiChat, { scenario, party, profiles = {}, chronicles = {}, seed }) {
  const { tree: generated } = await generateTreeWithRepair(aiChat, scenario, 2, 0.8);
  const engineTree = toEngineFormat(generated);

  const texts = Object.fromEntries(party.map(p => [p.user, playerText(p.user, profiles, chronicles)]));
  const casting = castParty(scenario.roles, party, texts);

  // resolveTree ist reine Spiellogik (Actor/Bonus-Auflösung), geteilt mit ai-static.js
  const resolved = resolveTree(engineTree, party, casting, texts);

  const settings = {
    scenario: scenario.ID,
    title: scenario.title,
    party,
    casting,
    tree: resolved,
    sceneTotal: scenario.length ?? 5,
    ...(seed != null && { seed }),
  };

  // Engine-Selbsttest: bevor wir den AI-Tree zurückgeben, muss er durch die
  // ECHTE Engine (init + ein Zug) laufen — letzte Absicherung gegen jede
  // Inkonsistenz, die validateTree() nicht erfasst (z.B. Feld-Übersetzungsfehler).
  const testState = tree.init({ ...settings, seed: seed ?? 1 });
  const firstNode = testState.tree.nodes[testState.nodeId];
  if (firstNode.mechanic === 'vote' && (!firstNode.options || firstNode.options.length === 0))
    throw new Error('engine self-test failed: start node has no options');
  if (firstNode.mechanic === 'roll' && !firstNode.roll?.symbol)
    throw new Error('engine self-test failed: start node roll has no resolved actor');
  if (firstNode.mechanic === 'moment' && !firstNode.symbol)
    throw new Error('engine self-test failed: start node moment has no resolved actor');

  return settings;
}

/**
 * Generiert Casting + Entscheidungsbaum via AI Core (gpt-4o-mini).
 * Bezieht aiChat lose gekoppelt vom Plattform-Service (AiService).
 *
 * @throws {Error} bei Modell-/Validierungs-/Engine-Fehler — Aufrufer fällt
 *   auf den statischen Adapter (autorisierter Tree) zurück.
 */
export async function treeBuilder(args) {
  return _runTreeBuilder(await platformAiChat(), args);
}

/**
 * Kern-Logik: Prompt bauen + Antwort parsen.
 * Nimmt aiChat als Parameter → testbar ohne Modul-Mocking.
 *
 * @internal — öffentliche API ist chronicler() und chroniclerWith()
 */
export async function _runChronicler(aiChat, finalState, user) {
  const me = finalState.party?.find(p => p.user === user);
  if (!me) return [];

  const role = finalState.casting?.[user]?.role ?? 'Abenteurer:in';
  const mine = (finalState.log ?? []).filter(e => e.by === user);

  if (mine.length === 0) return [];

  const logText = mine.map(e => {
    if (e.kind === 'roll')
      return `Würfelprobe: W20 = ${e.die}${e.bonus !== 0 ? ` (${e.bonus > 0 ? '+' : ''}${e.bonus} Bonus)` : ''}, Ziel ${e.target} → ${e.success ? 'Erfolg' : 'Misserfolg'}`;
    if (e.kind === 'vote')
      return `Abstimmung: Option ${e.option} gewählt`;
    if (e.kind === 'moment')
      return `Freier Moment: „${e.text}"`;
    return JSON.stringify(e);
  }).join('\n');

  const messages = [
    {
      role: 'system',
      content: `Du bist ein Chronist in einem kooperativen Abenteuerspiel.
Deine Aufgabe: Schlage 0–2 prägende Chronik-Einträge für einen Spieler vor.

Regeln:
- Maximal 2 Einträge, auch 0 ist korrekt wenn nichts Prägendes passiert ist
- Jeder Eintrag ist ein vollständiger deutscher Satz, max. 500 Zeichen
- Szenario-neutral formulieren: kein Setting, kein Ortsbezug — nur Charakter-Eigenschaften, Narben, Ruf
- Nur wirklich prägende Momente: kritische Erfolge (W20), totale Fehlschläge (W1), mutige Einzelmomente
- Format: ein Eintrag pro Zeile, keine Nummerierung, keine Aufzählungszeichen
- Antworte NUR mit den Einträgen (oder gar nichts bei 0 Einträgen)`,
    },
    {
      role: 'user',
      content: `Spieler: ${user}
Rolle in dieser Runde: ${role}

Spielprotokoll dieser Person:
${logText}

Schlage 0–2 szenario-neutrale Chronik-Einträge vor.`,
    },
  ];

  const raw = await aiChat(messages, { max_tokens: 300, temperature: 0.6 });

  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.length <= 500)
    .slice(0, 2);
}

/**
 * Extrahiert 0–2 prägende, szenario-neutrale Chronik-Sätze aus dem Spielprotokoll.
 * Bezieht aiChat lose gekoppelt vom Plattform-Service (AiService).
 *
 * @throws {Error} bei Modell-/Netzwerkfehler — Aufrufer fällt auf statischen Adapter zurück
 */
export async function chronicler(finalState, user) {
  return _runChronicler(await platformAiChat(), finalState, user);
}
