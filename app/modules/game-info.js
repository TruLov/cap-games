/**
 * game-info.js - per-game "info" page: how-to-play help text, a screenshot
 * gallery, and a single star row that doubles as the rating DISPLAY (shows
 * the current average when not interacting) and the rating INPUT (click a
 * star to submit your own, which re-fetches the freshly recalculated
 * average and repaints in place). Extracted from platform.js like
 * achievements.js/leaderboard.js; wired via initGameInfo(ctx) with the shell
 * services it needs.
 *
 * All three fields (help, gallery, avgStars/ratingCount/myStars) ride on
 * LobbyService.Games - see srv/lobby-service.js - so this module just renders
 * what it's given and posts rateGame on click.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ratingSummary = (g) =>
  `${g.avgStars != null ? g.avgStars.toFixed(1) : '-'} average · ${g.ratingCount} rating${g.ratingCount === 1 ? '' : 's'}`;

function render(g) {
  let gallery = [];
  try { gallery = JSON.parse(g.gallery || '[]'); } catch { /* malformed - show no gallery */ }

  const galleryHtml = gallery.length
    ? `<h3 class="sh-sec-title">Gallery</h3>
       <div class="gi-gallery">${gallery.map(src =>
         `<img src="${src}" loading="lazy" alt="${esc(g.name)} screenshot">`).join('')}</div>`
    : '';

  return `
    <h2>${esc(g.name)}</h2>
    <div class="gi-rating-row">
      <div id="gi-star-picker" class="gi-star-picker"></div>
      <span class="sh-small gi-summary-text">${ratingSummary(g)}</span>
    </div>
    <div id="gi-rate-status" class="sh-small"></div>
    <div class="gi-help">${esc(g.help || 'No instructions yet.')}</div>
    ${galleryHtml}`;
}

function wireStars(g, ctx) {
  const { serviceCall, toast } = ctx;
  const picker = document.getElementById('gi-star-picker');
  const status = document.getElementById('gi-rate-status');

  // Resting state shows the current AVERAGE (rounded) - this is a display
  // *and* an input at once, so hovering previews a click and leaving without
  // clicking falls back to whatever the average currently is, not your own
  // past rating.
  let restingValue = Math.round(g.avgStars ?? 0);

  const paint = (value) => picker.querySelectorAll('button').forEach(b =>
    b.textContent = Number(b.dataset.v) <= value ? '★' : '☆');

  const setStatus = () => {
    status.textContent = g.myStars ? `You rated this ${g.myStars} star${g.myStars > 1 ? 's' : ''}.` : 'Click a star to rate this game.';
  };

  picker.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const v = i + 1;
    return `<button type="button" class="gi-star" data-v="${v}" title="${v} star${v > 1 ? 's' : ''}">☆</button>`;
  }).join('');

  paint(restingValue);
  setStatus();

  picker.querySelectorAll('button').forEach(b => {
    b.onmouseenter = () => paint(Number(b.dataset.v));
    b.onmouseleave = () => paint(restingValue);
    b.onclick = async () => {
      const stars = Number(b.dataset.v);
      try {
        const result = await serviceCall('lobby', 'POST', 'rateGame', { game: g.id, stars });
        g.myStars = stars;
        g.avgStars = result.avgStars;
        g.ratingCount = result.ratingCount;
        restingValue = Math.round(g.avgStars ?? 0);
        paint(restingValue);
        setStatus();
        document.querySelector('.gi-summary-text').textContent = ratingSummary(g);
        toast('Thanks for rating!');
      } catch (e) {
        toast(e.message || 'Could not save rating');
      }
    };
  });
}

/**
 * Wire the game-info page. `ctx` supplies { $, serviceCall, showView, toast }.
 * Returns { showGameInfo } for the library card's info button.
 */
export function initGameInfo(ctx) {
  const { $, serviceCall, showView, toast } = ctx;

  async function showGameInfo(gameId) {
    showView('game-info');
    const root = $('game-info-root');
    root.innerHTML = '<div class="sh-small">Loading…</div>';
    try {
      const { value } = await serviceCall('lobby', 'GET', 'Games');
      const g = (value ?? []).find(x => x.id === gameId);
      if (!g) { root.innerHTML = '<div class="sh-small">Game not found.</div>'; return; }
      root.innerHTML = render(g);
      wireStars(g, { serviceCall, toast });
    } catch {
      root.innerHTML = '<div class="sh-small">Could not load game info.</div>';
    }
  }

  $('game-info-back-btn').onclick = () => showView('lobby');

  return { showGameInfo };
}
