/**
 * theme.js - light/dark theme toggle.
 *
 * Applied via [data-theme] on <html>; style.css defines both palettes under the
 * same variable names. index.html/logout.html set the initial value inline
 * (before first paint, no flash); this handles runtime toggling + persistence
 * and syncs the header toggle button's glyph. Extracted from platform.js - it
 * shares no application state, only the DOM + localStorage.
 */
const ICON_SUN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4' +
  'M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></svg>';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('theme', theme);
  const btn = document.getElementById('sh-theme-toggle');
  if (btn) btn.innerHTML = theme === 'light' ? ICON_MOON : ICON_SUN;
}

// Wire the toggle button and sync its glyph to the inline pre-paint choice.
export function initTheme() {
  const btn = document.getElementById('sh-theme-toggle');
  if (btn) btn.onclick = () =>
    applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  applyTheme(document.documentElement.dataset.theme ?? 'dark');
}
