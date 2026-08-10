/**
 * leaderboard.js — the per-game Leaderboard page.
 *
 * Reads the platform's Leaderboard OData entity (LobbyService), which already
 * resolves each row's display gamertag server-side via ProfileService (a
 * cds.connect.to service binding — see srv/lobby-service.js). The page just
 * picks a game, orders by points, and renders a ranked table. Extracted like
 * profile-edit.js / achievements.js; wired via initLeaderboard(ctx).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderRows(rows, meId) {
  if (!rows.length)
    return '<div class="sh-small">No matches played yet for this game.</div>';

  const body = rows.map((r, i) => `
    <tr class="${r.user === meId ? 'lb-me' : ''}">
      <td class="lb-rank tnum">${i + 1}</td>
      <td class="lb-name">${esc(r.gamertag || r.user)}</td>
      <td class="lb-pts tnum">${r.points}</td>
      <td class="lb-wld tnum">${r.wins}<span>–</span>${r.losses}<span>–</span>${r.draws}</td>
    </tr>`).join('');

  return `
    <table class="lb-table">
      <thead><tr>
        <th class="lb-rank">#</th><th class="lb-name">Player</th>
        <th class="lb-pts">Points</th><th class="lb-wld">W–L–D</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/**
 * Wire the leaderboard page. `ctx` supplies { $, serviceCall, showView, getUserId }.
 * Returns { showLeaderboardPage }.
 */
export function initLeaderboard(ctx) {
  const { $, serviceCall, showView, getUserId } = ctx;
  let loadedGames = false;

  async function loadGamesOnce() {
    if (loadedGames) return;
    const sel = $('leaderboard-game');
    try {
      const { value } = await serviceCall('lobby', 'GET', 'Games');
      sel.innerHTML = (value ?? [])
        .map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
      sel.onchange = () => loadRows(sel.value);
      loadedGames = true;
    } catch {
      sel.innerHTML = '';
    }
  }

  async function loadRows(game) {
    const table = $('leaderboard-table');
    table.innerHTML = '<div class="sh-small">Loading…</div>';
    try {
      const path = `Leaderboard?$filter=game eq '${encodeURIComponent(game)}'`
        + `&$orderby=points desc,wins desc`;
      const { value } = await serviceCall('lobby', 'GET', path);
      table.innerHTML = renderRows(value ?? [], getUserId());
    } catch {
      table.innerHTML = '<div class="sh-small">Could not load the leaderboard.</div>';
    }
  }

  async function showLeaderboardPage() {
    showView('leaderboard');
    await loadGamesOnce();
    const sel = $('leaderboard-game');
    if (sel.value) loadRows(sel.value);
    else $('leaderboard-table').innerHTML = '<div class="sh-small">No games available.</div>';
  }

  $('leaderboard-back-btn').onclick = () => showView('lobby');

  return { showLeaderboardPage };
}
