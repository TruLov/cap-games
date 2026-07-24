/**
 * AiService provider. Plugs the backend chosen by profile config
 * (cds.requires.ai.kind: 'mock' default, 'aicore' in [hybrid]/[production]) —
 * the mock/real decision lives in the config layer, not in runtime env checks.
 * Sibling of srv/ai-service.cds (bound by CAP's basename convention).
 */
import cds from '@sap/cds';
const LOG = cds.log('ai');

export default class AiService extends cds.Service {
  async init() {
    const kind = cds.env.requires?.ai?.kind ?? 'mock';
    const { chat } = kind === 'aicore'
      ? await import('./ai/aicore.js')
      : await import('./ai/mock.js');
    LOG.info(`AiService backend: ${kind}`);
    this.on('chat', req =>
      chat(JSON.parse(req.data.messages), req.data.options ? JSON.parse(req.data.options) : {}));
    return super.init();
  }
}
