/**
 * Unit tests — srv/ai.js (Plattform-AI-Client)
 *
 * Kein echter AI-Core-Call — prüft Konfigurationsvalidierung und
 * dass aiChat bei fehlendem Service-Key oder Deployment-ID sinnvoll wirft.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

function withEnv(vars, fn) {
  return async () => {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try { await fn(); }
    finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('aiChat rejects when AICORE_SERVICE_KEY is missing', async () => {
  // Reset cached client between tests
  const { _resetClientForTest, aiChat } = await import('../../srv/ai.js');
  _resetClientForTest();

  await withEnv({ AICORE_SERVICE_KEY: undefined, AICORE_DEPLOYMENT_ID: 'd1234' }, async () => {
    // cds.env.requires.ai might have deploymentId set — override via env for test isolation
    await assert.rejects(
      () => aiChat([{ role: 'user', content: 'test' }]),
      /AICORE_SERVICE_KEY/
    );
  })();
});

test('aiChat rejects when neither deploymentId config nor AICORE_DEPLOYMENT_ID is set', async () => {
  const { _resetClientForTest, aiChat } = await import('../../srv/ai.js');
  _resetClientForTest();

  await withEnv({
    AICORE_SERVICE_KEY: undefined,
    AICORE_DEPLOYMENT_ID: undefined,
  }, async () => {
    await assert.rejects(
      () => aiChat([{ role: 'user', content: 'test' }]),
      /AICORE_SERVICE_KEY|deploymentId/
    );
  })();
});
