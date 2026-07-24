import cds from '@sap/cds';
const LOG = cds.log('ai');

/** Lazy SDK client — built on first real call. */
let _client = null;
async function getClient() {
  if (_client) return _client;
  const cfg = cds.env.requires?.ai ?? {};
  const deploymentId = cfg.deploymentId || process.env.AICORE_DEPLOYMENT_ID;
  const resourceGroup = cfg.resourceGroup ?? process.env.AICORE_RESOURCE_GROUP ?? 'default';
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/foundation-models');
  _client = new AzureOpenAiChatClient({ deploymentId, resourceGroup });
  LOG.info('AI client initialised', { deploymentId, resourceGroup });
  return _client;
}

/**
 * Real AI Core backend. The SAP AI SDK resolves credentials natively from every
 * scenario — AICORE_SERVICE_KEY (local), the VCAP aicore binding (production),
 * or a `cds bind` instance (hybrid) — and throws if none is available, which the
 * caller (kaffee-kwest) turns into a graceful fallback to its static adapter.
 */
export async function chat(messages, opts = {}) {
  const { max_tokens = 500, temperature = 0.7, response_format } = opts;
  const body = { messages, max_tokens, temperature };
  if (response_format) body.response_format = response_format;
  const res = await (await getClient()).run(body);
  return res.getContent();
}
