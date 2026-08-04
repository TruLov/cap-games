/**
 * Flip Fortune — pixel-art sprites.
 *
 * Same hand-authored 16×16-grid technique as Kaperfahrt (see its sprites.js for
 * the full rationale): a row of chars keyed into a palette, merged into <rect>s
 * for a crisp scalable SVG with no binary assets. Icons here are the three
 * action-card glyphs, a card-back pattern for the face-down deck, and a small
 * star used on the Flip 7 / win celebration.
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

const cardback = grid([
  'KKKKKKKKKKKKKKKK',
  'K..............K',
  'K.PPPPPPPPPPPP.K',
  'K.P..........P.K',
  'K.P.PPPPPPPP.P.K',
  'K.P.P......P.P.K',
  'K.P.P.PPPP.P.P.K',
  'K.P.P.P..P.P.P.K',
  'K.P.P.P..P.P.P.K',
  'K.P.P.PPPP.P.P.K',
  'K.P.P......P.P.K',
  'K.P.PPPPPPPP.P.K',
  'K.P..........P.K',
  'K.PPPPPPPPPPPP.K',
  'K..............K',
  'KKKKKKKKKKKKKKKK',
], { K: '#1c1d3c', P: '#3b3e78' });

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

export const SPRITE = { freeze, flipthree, secondchance, cardback, star };
