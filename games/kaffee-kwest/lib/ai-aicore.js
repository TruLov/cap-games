/**
 * Kaffee-Kwest — AI-Core-Adapter (v1.5).
 *
 * Implementiert die beiden AI-Ports mit echten Modell-Calls:
 *   treeBuilder — re-exportiert statisch (bleibt vorerst ohne AI, s. v2-Roadmap)
 *   chronicler  — nutzt gpt-4o-mini via Plattform-AI-Client (srv/ai.js)
 *
 * Fallback-Garantie: wirft bei Fehler → KaffeeKwestService fällt auf ai-static zurück.
 * Runde bricht nie ab (Architektur-Vorgabe).
 *
 * Selbe Signatur wie ai-static.js — austauschbar ohne Änderung am Aufrufer.
 */

export { treeBuilder } from './ai-static.js';

/**
 * Kern-Logik: Prompt bauen + Antwort parsen.
 * Nimmt aiChat als Parameter → testbar ohne Modul-Mocking.
 *
 * @internal — öffentliche API ist chronicler() und chroniclerWith()
 */
export async function _runChronicler(aiChat, finalState, user) {
  const me = finalState.party?.find(p => p.user === user);
  if (!me) return [];

  const role = finalState.casting?.[me.symbol]?.role ?? 'Abenteurer:in';
  const mine = (finalState.log ?? []).filter(e => e.by === me.symbol);

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
 * Lädt aiChat lazy vom Plattform-Client (srv/ai.js).
 *
 * @throws {Error} bei Modell-/Netzwerkfehler — Aufrufer fällt auf statischen Adapter zurück
 */
export async function chronicler(finalState, user) {
  const { aiChat } = await import('../../../srv/ai.js');
  return _runChronicler(aiChat, finalState, user);
}
