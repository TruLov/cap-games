/**
 * achievements.js — the "Achievements" browse page (Steam-style, per game).
 *
 * Shows, per game (and a "Platform" section for cross-game meta), the
 * achievements the user has UNLOCKED in full, plus a single "N locked" row
 * standing in for everything still to earn. Locked achievements are never
 * named or described — the server (LobbyService.myAchievements) only ever
 * sends owned entries + a per-game total, so "how many are left" is all the UI
 * can (and should) reveal. Extracted from platform.js like profile-edit.js;
 * wired via initAchievements(ctx) with the shell services it needs.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderGame(g) {
  const left = Math.max(0, g.total - g.owned.length);

  const owned = g.owned.map(a => `
    <div class="ach-row ach-owned">
      <div class="ach-icon">🏆</div>
      <div class="ach-text">
        <div class="ach-name">${esc(a.name)}</div>
        <div class="ach-desc">${esc(a.desc)}</div>
      </div>
    </div>`).join('');

  const locked = left > 0 ? `
    <div class="ach-row ach-locked">
      <div class="ach-icon">🔒</div>
      <div class="ach-text">
        <div class="ach-name">${left} locked</div>
        <div class="ach-desc">Keep playing to unlock ${left === 1 ? 'it' : 'them'}.</div>
      </div>
    </div>` : '';

  const empty = !g.owned.length && !left
    ? '<div class="sh-small">No achievements defined.</div>' : '';

  return `
    <section class="ach-game">
      <h3>${esc(g.gameName)} <span class="ach-count">${g.owned.length} / ${g.total}</span></h3>
      ${owned}${locked}${empty}
    </section>`;
}

/**
 * Wire the achievements page. `ctx` supplies { $, serviceCall, showView }.
 * Returns { showAchievementsPage } for the account menu entry.
 */
export function initAchievements(ctx) {
  const { $, serviceCall, showView } = ctx;

  async function showAchievementsPage() {
    showView('achievements');
    const root = $('achievements-list');
    root.innerHTML = '<div class="sh-small">Loading…</div>';
    try {
      const { value } = await serviceCall('lobby', 'GET', 'myAchievements()');
      root.innerHTML = value?.length
        ? value.map(renderGame).join('')
        : '<div class="sh-small">No achievements yet.</div>';
    } catch {
      root.innerHTML = '<div class="sh-small">Could not load achievements.</div>';
    }
  }

  $('achievements-back-btn').onclick = () => showView('lobby');

  return { showAchievementsPage };
}
