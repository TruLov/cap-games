/**
 * Platform AI client — generische Brücke zu SAP AI Core (foundation-models).
 *
 * Exportiert: aiChat(messages, opts?) → string (Modellantwort)
 *
 * Konfiguration (cds.requires.ai):
 *   deploymentId  — AI-Core-Deployment-ID (bestimmt das Modell, z.B. gpt-4o-mini)
 *   resourceGroup — AI-Resource-Group (default: 'default')
 *   model         — Modellname (nur dokumentarisch, Deployment-ID ist maßgeblich)
 *
 * Secret: AICORE_SERVICE_KEY Env-Var (JSON aus dem AI-Core-Service-Key).
 * Das SAP AI SDK liest dieses Env selbst — kein eigenes OAuth-Handling nötig.
 *
 * Das Modul lädt das SDK lazy (dynamischer Import), damit `cds watch` und CI
 * ohne AICORE_SERVICE_KEY laufen, solange kein Aufrufer aiChat() tatsächlich ruft.
 *
 * Eigentümer: Plattform — spielunabhängig, wiederverwendbar für alle KI-Games.
 */

import cds from '@sap/cds';

const LOG = cds.log('ai');

/** Lazy-geladener SDK-Client: wird nur instanziiert, wenn wirklich gebraucht. */
let _client = null;

async function getClient() {
  if (_client) return _client;

  // Service-Key zuerst prüfen — ohne Credentials ist deploymentId wertlos
  if (!process.env.AICORE_SERVICE_KEY)
    throw new Error('AI Core not configured: AICORE_SERVICE_KEY env var is missing');

  const cfg = cds.env.requires?.ai ?? {};
  const deploymentId = cfg.deploymentId || process.env.AICORE_DEPLOYMENT_ID;
  const resourceGroup = cfg.resourceGroup ?? process.env.AICORE_RESOURCE_GROUP ?? 'default';

  if (!deploymentId)
    throw new Error('AI Core not configured: set cds.requires.ai.deploymentId or AICORE_DEPLOYMENT_ID');

  // Dynamischer Import — SDK wird nur geladen wenn aiChat() tatsächlich aufgerufen wird.
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/foundation-models');

  _client = new AzureOpenAiChatClient({ deploymentId, resourceGroup });
  LOG.info('AI client initialised', { deploymentId, resourceGroup, model: cfg.model });
  return _client;
}

/**
 * Sendet eine Chat-Completion-Anfrage an das konfigurierte AI-Core-Deployment.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [opts]
 * @param {number} [opts.max_tokens=500]
 * @param {number} [opts.temperature=0.7]
 * @param {object} [opts.response_format] — z.B. { type: 'json_schema', json_schema: {...} }
 * @returns {Promise<string>} Modell-Antwort als String
 * @throws {Error} bei Konfigurationsfehler oder HTTP-Fehler — Aufrufer fällt zurück auf statischen Adapter
 */
export async function aiChat(messages, opts = {}) {
  const client = await getClient();
  const { max_tokens = 500, temperature = 0.7, response_format } = opts;

  const body = { messages, max_tokens, temperature };
  if (response_format) body.response_format = response_format;

  const response = await client.run(body);
  return response.getContent();
}

/** Setzt den gecachten Client zurück — nur für Tests. */
export function _resetClientForTest() {
  _client = null;
}
