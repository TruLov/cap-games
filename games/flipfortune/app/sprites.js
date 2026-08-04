/**
 * Flip Fortune — pixel-art sprites (High-Roller Card Room theme).
 *
 * Same hand-authored 16×16-grid technique as Kaperfahrt's sprites.js: a row of
 * chars keyed into a palette, merged into <rect>s for a crisp scalable SVG
 * with no binary assets. `deckstack` is a thick angled stack of card edges —
 * deliberately distinct from an individual card front, so the pile always
 * reads as "the deck" rather than just another card. `chip` is a single poker
 * chip (stacked N-high by the scoreboard to show progress toward the target).
 * The three action-card glyphs and `star` (win screen) round out the set.
 */

function grid(rows, pal) {
  let rects = '';
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') { x++; continue; }
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      rects += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${pal[ch]}"/>`;
      x += w;
    }
  }
  return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" `
       + `shape-rendering="crispEdges" width="100%" height="100%" `
       + `preserveAspectRatio="xMidYMid meet">${rects}</svg>`;
}

const freeze = grid([
  '.......BB.......',
  '.......BB.......',
  '...B...BB...B...',
  '....B..BB..B....',
  '.....B.BB.B.....',
  'BBBBB.BB.BBBBB..',
  '.BB..B.BB.B..BB.',
  '..BB.BBBBBB.BB..',
  '..BB.BBBBBB.BB..',
  '.BB..B.BB.B..BB.',
  'BBBBB.BB.BBBBB..',
  '.....B.BB.B.....',
  '....B..BB..B....',
  '...B...BB...B...',
  '.......BB.......',
  '.......BB.......',
], { B: '#6fd7f2' });

const flipthree = grid([
  '................',
  '..CCCCC.........',
  '.CCCCCCC.CCCC...',
  'CCCCCCCC.C..C...',
  'CCC..CCC.C..CCC.',
  'CCC..CCC.CCCC.C.',
  'CCC..CCC.....C..',
  '.CCCCCCC..CCCC..',
  '..CCCCC...C..C..',
  '..........C..C..',
  '..........CCCC..',
  '................',
  'AAA..........AAA',
  'A..A........A..A',
  'A...AA....AA...A',
  '..AAA..AA..AAA..',
], { C: '#f5c542', A: '#b0821a' });

const secondchance = grid([
  '.....BBBBBB.....',
  '...BBGGGGGGBB...',
  '..BGGGGGGGGGGB..',
  '.BGGGWWWWWWGGGB.',
  'BGGGGWWWWWWGGGGB',
  'BGGGGGWWWWGGGGGB',
  'BGGGGGWWWWGGGGGB',
  'BGGGGWWWWWWGGGGB',
  '.BGGGWWWWWWGGGB.',
  '.BGGGGGGGGGGGGB.',
  '..BGGGGGGGGGGB..',
  '...BGGGGGGGGB...',
  '....BGGGGGGB....',
  '.....BGGGGB.....',
  '......BGGB......',
  '.......BB.......',
], { B: '#1e8a5b', G: '#3ecf8e', W: '#e9fff2' });

const star = grid([
  '.......GG.......',
  '.......GG.......',
  '......GGGG......',
  '......GGGG......',
  '.....GGGGGG.....',
  'GG...GGGGGG...GG',
  'GGGG.GGGGGG.GGGG',
  '.GGGGGGGGGGGGGG.',
  '..GGGGGGGGGGGG..',
  '...GGGGGGGGGG...',
  '...GGG....GGG...',
  '..GGG......GGG..',
  '..GG........GG..',
  '.GG..........GG.',
  '................',
  '................',
], { G: '#f5c542' });

// The deck — a thick angled stack of fanned card edges, brass-trimmed, on a
// deep felt shadow. Reads as "a pile", never mistaken for a single card.
const deckstack = grid([
  '.....KKKKKKKKKK.',
  '....KPPPPPPPPKK.',
  '...KPWWWWWWWWPK.',
  '..KPWWWWWWWWWPK.',
  '.KPWWWWWWWWWWPK.',
  'KPWWWWWWWWWWWPK.',
  'KPWCCCCCCCCCWPK.',
  'KPWCDDDDDDDCWPK.',
  'KPWCDBBBBBDCWPK.',
  'KPWCDBBBBBDCWPK.',
  'KPWCDDDDDDDCWPK.',
  'KPWCCCCCCCCCWPK.',
  'KPWWWWWWWWWWPK..',
  'KPPPPPPPPPPPK...',
  'KKKKKKKKKKKK....',
  '................',
], { K: '#1a0810', P: '#5c1f2e', W: '#7a2c3d', C: '#d4a03c', D: '#8a6420', B: '#3a1220' });

// A single poker chip — stacked N-high by the scoreboard.
const chip = grid([
  '......BBBB......',
  '....BBGGGGBB....',
  '...BGGCCCCGGB...',
  '..BGCC....CCGB..',
  '.BGC..GGGG..CGB.',
  '.BGC.GWWWWG.CGB.',
  'BGC..GWWWWG..CGB',
  'BGC..GWWWWG..CGB',
  '.BGC.GWWWWG.CGB.',
  '.BGC..GGGG..CGB.',
  '..BGCC....CCGB..',
  '...BGGCCCCGGB...',
  '....BBGGGGBB....',
  '......BBBB......',
  '................',
  '................',
], { B: '#4a0f1a', G: '#d4a03c', C: '#8a6420', W: '#f4efe1' });

export const SPRITE = { freeze, flipthree, secondchance, star, deckstack, chip };
