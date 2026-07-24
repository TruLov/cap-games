/**
 * Unit tests — platform AiService.
 *
 * The mock/real decision is a config/profile choice (cds.requires.ai.kind);
 * under the default profile the provider plugs the mock backend, which throws
 * so callers uniformly fall back to their own no-AI behaviour.
 */

import cds from '@sap/cds';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chat as mockChat } from '../../srv/ai/mock.js';

cds.test(process.cwd());

test('mock backend throws — "no AI configured" is a first-class outcome, not a fake reply', async () => {
  await assert.rejects(() => mockChat([{ role: 'user', content: 'hallo welt' }]), /no AI configured/);
});

test('AiService (default profile) is connectable; chat() rejects via the mock backend', async () => {
  const ai = await cds.connect.to('AiService');
  await assert.rejects(() => ai.send('chat', {
    messages: JSON.stringify([{ role: 'user', content: 'ping' }]),
    options: '{}',
  }));
});

test('the active backend is selected by cds.requires.ai.kind (mock by default)', () => {
  assert.equal(cds.env.requires?.ai?.kind ?? 'mock', 'mock');
});
