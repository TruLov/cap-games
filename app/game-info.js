/**
 * game-info.js - per-game "info" page: how-to-play help text, a screenshot
 * gallery, and a 1-5 star rating widget. Extracted from platform.js like
 * achievements.js/leaderboard.js; wired via initGameInfo(ctx) with the shell
 * services it needs.
 *
 * All three fields (help, gallery, avgStars/ratingCount/myStars) ride on
 * LobbyService.Games - see srv/lobby-service.js - so this module just renders
 * what it's given and posts rateGame on click.
 */

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const starGlyphs = (v) => Array.from({ length: 5 }, (_, i) => i < Math.round(v) ? '★' : '☆').join('');

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
    <div class="gi-rating-summary">
      <span class="gi-avg-stars">${starGlyphs(g.avgStars ?? 0)}</span>
      <span class="sh-small gi-summary-text">${ratingSummary(g)}</span>
    </div>
    <div class="gi-help">${esc(g.help || 'No instructions yet.')}</div>
    ${galleryHtml}
    <h3 class="sh-sec-title">Rate this game</h3>
    <div id="gi-star-picker" class="gi-star-picker"></div>
    <div id="gi-rate-status" class="sh-small"></div>`;
}

function wireStars(g, ctx) {
  const { serviceCall, toast } = ctx;
  const picker = document.getElementById('gi-star-picker');
  const status = document.getElementById('gi-rate-status');

  const paint = (value) => picker.querySelectorAll('button').forEach(b =>
    b.textContent = Number(b.dataset.v) <= value ? '★' : '☆');

  const setStatus = (stars) => {
    status.textContent = stars ? `You rated this ${stars} star${stars > 1 ? 's' : ''}.` : 'Not rated yet.';
  };

  picker.innerHTML = Array.from({ length: 5 }, (_, i) => {
    const v = i + 1;
    return `<button type="button" class="gi-star" data-v="${v}" title="${v} star${v > 1 ? 's' : ''}">☆</button>`;
  }).join('');

  paint(g.myStars ?? 0);
  setStatus(g.myStars);

  picker.querySelectorAll('button').forEach(b => {
    b.onmouseenter = () => paint(Number(b.dataset.v));
    b.onmouseleave = () => paint(g.myStars ?? 0);
    b.onclick = async () => {
      const stars = Number(b.dataset.v);
      try {
        const result = await serviceCall('lobby', 'POST', 'rateGame', { game: g.id, stars });
        g.myStars = stars;
        g.avgStars = result.avgStars;
        g.ratingCount = result.ratingCount;
        paint(stars);
        setStatus(stars);
        document.querySelector('.gi-avg-stars').textContent = starGlyphs(g.avgStars ?? 0);
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
