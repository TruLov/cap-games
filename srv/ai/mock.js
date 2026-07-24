/**
 * No-op AI backend — the default (local dev / CI). No SDK, no credentials.
 *
 * Throws rather than returning a stub reply: callers (e.g. kaffee-kwest's AI
 * adapter) treat any chat() failure as "no AI available" and fall back to
 * their own static/no-AI behaviour — so the mock backend and "AI Core is
 * unreachable" produce the exact same, uniform fallback path.
 */
export async function chat() {
  throw new Error('AiService: mock backend — no AI configured (see cds.requires.ai.kind)');
}
