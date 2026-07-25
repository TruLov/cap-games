import cds from '@sap/cds';
const LOG = cds.log('ai');

/** Lazy SDK client — built on first real call. */
let _client = null;
let _reasoningModel = false;
async function getClient() {
  if (_client) return _client;
  const cfg = cds.env.requires?.ai ?? {};
  const deploymentId = cfg.deploymentId || process.env.AICORE_DEPLOYMENT_ID;
  const resourceGroup = cfg.resourceGroup ?? process.env.AICORE_RESOURCE_GROUP ?? 'default';
  // Reasoning-family deployments (gpt-5*, o1*, o3*, o4*, ...) reject a custom
  // `temperature` and instead need `reasoning_effort` — a deployment property,
  // not a game concern, so it's a knob next to deploymentId, not in game code.
  _reasoningModel = cfg.reasoningModel ?? /^true$/i.test(process.env.AICORE_REASONING_MODEL ?? '');
  const { AzureOpenAiChatClient } = await import('@sap-ai-sdk/foundation-models');
  _client = new AzureOpenAiChatClient({ deploymentId, resourceGroup });
  LOG.info('AI client initialised', { deploymentId, resourceGroup, reasoningModel: _reasoningModel });
  return _client;
}

/**
 * Real AI Core backend. The SAP AI SDK resolves credentials natively from every
 * scenario — AICORE_SERVICE_KEY (local), the VCAP aicore binding (production),
 * or a `cds bind` instance (hybrid) — and throws if none is available, which the
 * caller (kaffee-kwest) turns into a graceful fallback to its static adapter.
 */
export async function chat(messages, opts = {}) {
  const client = await getClient();
  const { max_tokens = 500, temperature = 0.7, reasoningEffort = 'minimal', response_format } = opts;
  const body = { messages, max_completion_tokens: max_tokens };
  if (_reasoningModel) body.reasoning_effort = reasoningEffort;
  else body.temperature = temperature;
  if (response_format) body.response_format = response_format;
  const res = await client.run(body);
  return res.getContent();
}
