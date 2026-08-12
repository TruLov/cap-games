/**
 * Kaperfahrt - pixel-art sprites.
 *
 * Each icon is hand-authored on a 16×16 grid: an array of 16 strings, one char
 * per pixel. A char keys into the sprite's palette; '.' / ' ' are transparent.
 * `grid()` merges horizontal runs into <rect>s and returns a crisp, scalable
 * SVG string (no binary assets, fully diffable, recolour-free - each sprite owns
 * its palette). Consumers drop the string into a sized box; `shape-rendering:
 * crispEdges` keeps every pixel hard-edged at any scale.
 *
 * `SPRITE[name]` → SVG string. The 6 die faces are the hero art; the rest are
 * card icons. `coin`/`diamond`/`skull`/`monkey` are reused as card icons too.
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

// --- die faces -------------------------------------------------------------

const coin = grid([
  '....KKKKKKKK....',
  '..KKGGGGGGGGKK..',
  '.KGGGGGGGGGGGGK.',
  '.KGGGDDDDDDGGGK.',
  'KGGGDHHHHHHDGGGK',
  'KGGDHHGGGGHHDGGK',
  'KGGDHGGGGGGHDGGK',
  'KGGDHGGGGGGHDGGK',
  'KGGDHHGGGGHHDGGK',
  'KGGGDHHHHHHDGGGK',
  '.KGGGDDDDDDGGGK.',
  '.KGGGGGGGGGGGGK.',
  '..KKGGGGGGGGKK..',
  '....KKKKKKKK....',
], { K: '#3a2c07', G: '#f5c542', D: '#b0821a', H: '#ffe9a8' });

const diamond = grid([
  '................',
  '...KKKKKKKKKK...',
  '..KCCCCCCCCCCK..',
  '.KCHHCCCCCCCCCK.',
  'KCCHCCCCCCCCCCCK',
  'KCCCCCCCCCCCCCcK',
  '.KCCCCCCCCCCCcK.',
  '..KCCCCCCCCCcK..',
  '...KCCCCCCCcK...',
  '....KCCCCCcK....',
  '.....KCCCcK.....',
  '......KCcK......',
  '.......KK.......',
], { K: '#0b3a4a', C: '#5fd6e8', c: '#2f9fc4', H: '#eaffff' });

const skull = grid([
  '................',
  '...KKKKKKKKKK...',
  '..KBBBBBBBBBBK..',
  '.KBBBBBBBBBBBBK.',
  'KBBBBBBBBBBBBBBK',
  'KBBKKBBBBBBKKBBK',
  'KBBKKBBBBBBKKBBK',
  'KBBBBBBKKBBBBBBK',
  'KBBBBBBBBBBBBBBK',
  '.KBBBBBBBBBBBBK.',
  '..KBBBBBBBBBBK..',
  '..KBKBKBKBKBBK..',
  '..KBKBKBKBKBBK..',
  '..KKKKKKKKKKKK..',
], { K: '#241a3a', B: '#f4efe1' });

const saber = grid([
  '.............KKK',
  '............KWSK',
  '...........KWSK.',
  '..........KWSK..',
  '.........KWSK...',
  '........KWSK....',
  '.......KWSK.....',
  '......KWSK......',
  '.....KWSK.......',
  '...KKGGGGKK.....',
  '...KGGGGGGK.....',
  '.....KHHK.......',
  '.....KHHK.......',
  '....KKPPKK......',
  '....KPPPPK......',
  '.....KKKK.......',
], { K: '#20242e', W: '#eef1fa', S: '#aeb4cc', G: '#f5c542', H: '#8a5a2c', P: '#c98a1c' });

const parrot = grid([
  '......KKKK......',
  '....KKRRRRKK....',
  '...KRRRRRRRRK...',
  '..KRRRRRRRRRRK..',
  '..KRRWWRRRRRRK..',
  '.KYKRWERRRRRRK..',
  '.KYYKRRRRRRRRK..',
  '..KKRRRBBBBRRK..',
  '...KRRRBBBBBBK..',
  '...KRRRBBBBBBK..',
  '...KRRRRBBBBRK..',
  '...KRRRRRRRRK...',
  '....KRRRRRRK....',
  '....KRRRRRRK....',
  '.....KGKKGK.....',
  '................',
], { K: '#2a1030', R: '#e5484d', B: '#3b7dd8', Y: '#f5c542', E: '#2a1030', W: '#ffffff', G: '#f5c542' });

const monkey = grid([
  '................',
  '....KKKKKKKK....',
  '..KKMMMMMMMMKK..',
  '.KMMMMMMMMMMMMK.',
  'KMKMMMMMMMMMMKMK',
  'KMKMFFFFFFFFMKMK',
  'KMKMFEFFFFEFMKMK',
  'KMKMFFFFFFFFMKMK',
  '.KMMFFFmmFFFMMK.',
  '.KMMFFFFFFFFMMK.',
  '..KMMFFFFFFMMK..',
  '..KMMMFFFFMMMK..',
  '...KMMMMMMMMK...',
  '....KKMMMMKK....',
  '......KKKK......',
  '................',
], { K: '#2a1a10', M: '#a9713f', m: '#7a4e28', F: '#e6c197', E: '#2a1a10' });

// --- card-only icons -------------------------------------------------------

const sorceress = grid([
  '.......KK.......',
  '......KPPK......',
  '......KPYK......',
  '.....KPPPK......',
  '.....KPPPK......',
  '....KPPPPK......',
  '....KPYPPK.....',
  '...KPPPPPK.....',
  '...KPPPPPPK....',
  '..KPPPPPPPK....',
  '..KPPPYPPPPK...',
  '.KPPPPPPPPPPK..',
  'KKKKKKKKKKKKKKK',
  'KWWWWWWWWWWWWWK',
  '.KKKKKKKKKKKKK.',
], { K: '#1e1040', P: '#8b5cf6', Y: '#f5c542', W: '#b79cf0' });

const captain = grid([
  '......KKKK......',
  '.....KSSSSK.....',
  '.....KS..SK.....',
  '.....KSSSSK.....',
  '......KSSK......',
  '...KKKKSSKKKK...',
  '...KSSSSSSSSK...',
  '......KSSK......',
  '......KSSK......',
  '......KSSK......',
  'K.....KSSK.....K',
  'KS....KSSK....SK',
  'KSK..KKSSKK..KSK',
  '.KSKKKS..SKKKSK.',
  '..KSSSK..KSSSK..',
  '...KKK....KKK...',
], { K: '#1a2230', S: '#c7ccdd' });

const seabattle = grid([
  'KK..........KK..',
  'KSSK......KSSK..',
  '.KSSK....KSSK...',
  '..KSSK..KSSK....',
  '...KSSKKSSK.....',
  '....KSSSSK......',
  '....KGGGGK......',
  '...KSSKKSSK.....',
  '..KSSK..KSSK....',
  '.KSHK....KHSK...',
  'KSHK......KHSK..',
  'KHK........KHK..',
], { K: '#20242e', S: '#dfe4f0', G: '#f5c542', H: '#7a4a26' });

const chest = grid([
  '................',
  '..KKKKKKKKKKKK..',
  '.KWWWWWWWWWWWWK.',
  '.KWGGGGGGGGGGWK.',
  '.KWWWWWWWWWWWWK.',
  'KKKKKKKKKKKKKKKK',
  'KGGGGGGLLGGGGGGK',
  'KWWWWWWLLWWWWWWK',
  'KWWWWWWLLWWWWWWK',
  'KWWWWWWWWWWWWWWK',
  'KWWWWWWWWWWWWWWK',
  'KKKKKKKKKKKKKKKK',
], { K: '#2a1810', W: '#a9713f', G: '#f5c542', L: '#3a2810' });

export const SPRITE = {
  parrot, monkey, saber, coin, diamond, skull,
  sorceress, captain, seabattle, chest,
  animals: monkey, curse: skull,
};
