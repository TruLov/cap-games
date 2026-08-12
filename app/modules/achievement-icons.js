/**
 * achievement-icons.js - per-achievement SVG glyphs + a fixed per-game color
 * theme, so achievements are identifiable by look alone (game/platform =
 * color + icon family; each individual achievement = its own glyph within
 * that family). Colors are hardcoded (not `var(--accent)`) - they must stay
 * distinct from EACH OTHER regardless of which UI palette is active, unlike
 * the star rating or nav icons which intentionally follow the palette.
 *
 * Consumed by app/platform.js (rail badges), app/modules/profile-edit.js (pin
 * picker), and app/modules/achievements.js (browse page) - one source of truth so
 * the same achievement always renders identically everywhere.
 */

export const ACH_THEMES = {
  '':             { name: 'Platform',            color: '#cf9a5c' }, // coffee
  tictactoe:      { name: 'TicTacToe',            color: '#8a6fd9' }, // violet
  mttt:           { name: 'Ultimate Tic-Tac-Toe', color: '#4f8fe0' }, // blue
  kaiten:         { name: 'Kaiten',               color: '#3fae94' }, // teal
  flipfortune:    { name: 'Flip Fortune',         color: '#d9a83f' }, // gold
  kaperfahrt:     { name: 'Kaperfahrt',           color: '#c25a52' }, // red
  'snake-ladder': { name: 'Snake & Ladder',       color: '#6fae4f' }, // green
};

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

// Bespoke glyph per achievement, keyed "<game>:<id>" (game '' = platform).
const ICONS = {
  // Platform - coffee family
  ':firstWin': svg(`
    <path d="M6 9h11v4a5.5 5.5 0 0 1-11 0V9z"/>
    <path d="M17 10h1.5a2 2 0 0 1 0 4H17"/>
    <path d="M9 19h5"/>
    <path d="M11.5 3.3l.6 1.4 1.5.2-1.1 1 .3 1.5-1.3-.7-1.3.7.3-1.5-1.1-1 1.5-.2z" fill="currentColor" stroke="none"/>
  `),
  ':allGames': svg(`
    <path d="M3 10h4v3a2 2 0 0 1-4 0v-3z"/>
    <path d="M10 8h4v5a2 2 0 0 1-4 0V8z"/>
    <path d="M17 10h4v3a2 2 0 0 1-4 0v-3z"/>
    <path d="M4 19h16"/>
  `),

  // TicTacToe - O-mark family
  'tictactoe:underdog': svg(`
    <circle cx="12" cy="10" r="6"/>
    <path d="M9 20l3-3 3 3"/>
  `),

  // Ultimate Tic-Tac-Toe - nested-grid family
  'mttt:speedDemon': svg(`
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    <path d="M13 8l-3 4h2.3l-1.3 4 3.8-5H12z" fill="currentColor" stroke="none"/>
  `),
  'mttt:boardSweep': svg(`
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
    <path d="M5 12l5 5L20 6" stroke-width="2.4"/>
  `),

  // Kaiten - sushi family
  'kaiten:dessertMaster': svg(`
    <ellipse cx="12" cy="15" rx="8" ry="4"/>
    <path d="M6 15a6 3 0 0 1 12 0"/>
    <circle cx="12" cy="8" r="2" fill="currentColor" stroke="none"/>
  `),
  'kaiten:bigAppetite': svg(`
    <ellipse cx="12" cy="18" rx="9" ry="2.2"/>
    <ellipse cx="12" cy="13" rx="7" ry="2"/>
    <ellipse cx="12" cy="8.5" rx="5" ry="1.8"/>
  `),

  // Flip Fortune - card family
  'flipfortune:flipSeven': svg(`
    <rect x="5" y="3" width="10" height="15" rx="1.5" transform="rotate(-8 5 3)"/>
    <path d="M9 8h5l-3 6"/>
  `),
  'flipfortune:highRoller': svg(`
    <rect x="4" y="4" width="11" height="16" rx="1.5"/>
    <circle cx="18" cy="7" r="2.6"/>
    <circle cx="18" cy="13" r="2.6"/>
  `),

  // Kaperfahrt - pirate family
  'kaperfahrt:pirateKing': svg(`
    <path d="M4 20L18 6M4 6l14 14"/>
    <path d="M4 20l3-1M20 4l-3 1M4 6l3 1M20 20l-3-1"/>
  `),

  // Snake & Ladder - dice family
  'snake-ladder:bullseye': svg(`
    <rect x="4" y="4" width="16" height="16" rx="3"/>
    <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="16" r="1.2" fill="currentColor" stroke="none"/>
  `),
};

// Generic per-family glyph - used for any achievement id not (yet) given its
// own bespoke icon above, so a new achievement still looks "on theme" the
// moment it's declared in a game's pure module.
const FAMILY_FALLBACK = {
  '': svg(`<path d="M6 9h11v4a5.5 5.5 0 0 1-11 0V9z"/><path d="M17 10h1.5a2 2 0 0 1 0 4H17"/><path d="M9 19h5"/>`),
  tictactoe: svg(`<circle cx="12" cy="12" r="7"/>`),
  mttt: svg(`<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>`),
  kaiten: svg(`<ellipse cx="12" cy="14" rx="8" ry="4"/><path d="M6 14a6 3 0 0 1 12 0"/>`),
  flipfortune: svg(`<rect x="5" y="3" width="14" height="18" rx="1.5"/>`),
  kaperfahrt: svg(`
    <path d="M12 3a7 7 0 0 0-7 7c0 3 1.6 4.7 2 6v2h2v-2h6v2h2v-2c.4-1.3 2-3 2-6a7 7 0 0 0-7-7z"/>
    <circle cx="9" cy="10" r="1.3" fill="currentColor" stroke="none"/>
    <circle cx="15" cy="10" r="1.3" fill="currentColor" stroke="none"/>
  `),
  'snake-ladder': svg(`<path d="M7 3v18M17 3v18M7 8h10M7 13h10M7 18h10"/>`),
};

const DEFAULT_ICON = svg(`<circle cx="12" cy="12" r="8"/>`);

export function achievementIcon(game, id) {
  return ICONS[`${game}:${id}`] ?? FAMILY_FALLBACK[game] ?? DEFAULT_ICON;
}

export function achievementColor(game) {
  return ACH_THEMES[game]?.color ?? 'currentColor';
}
