/**
 * Procedural "sprayed on metal" GAMBITO wordmark — cyberpunk stencil-graffiti
 * treatment. Renders into a <canvas> at call time rather than shipping a
 * static image, so the same code produces both the compact header mark and
 * the large start-page hero from one set of parameters.
 *
 * Deliberately a fixed dark/neon artwork independent of the light/dark
 * theme toggle — same reasoning as the mttt board's neon skin: a sprayed
 * tag doesn't repaint itself for daytime.
 */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const AMBER = hexToRgb('#ff8f1f');
const AMBER_DARK = hexToRgb('#b85f0e');
const CYAN = hexToRgb('#17e0ff');
const FONT_STACK = '"Arial Narrow", "Helvetica Neue Condensed", "Liberation Sans Narrow", sans-serif';
const TAG_ANGLE = -4 * Math.PI / 180;

function paintPlate(ctx, w, h, rng) {
  const base = ctx.createLinearGradient(0, 0, w, h);
  base.addColorStop(0, '#1c1812');
  base.addColorStop(.5, '#171410');
  base.addColorStop(1, '#100d0a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const area = (w * h) / (1500 * 780);
  for (let i = 0; i < Math.round(900 * area); i++) {
    const y = rng() * h, x = rng() * w;
    const len = 30 + rng() * 140;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 0.6 + rng() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (rng() - 0.5) * 3);
    ctx.stroke();
  }

  const rustSpots = [
    [w * 0.06, h * 0.88, w * 0.16], [w * 0.95, h * 0.1, w * 0.13],
    [w * 0.02, h * 0.08, w * 0.1], [w * 0.98, h * 0.92, w * 0.18],
  ];
  for (const [rx, ry, r] of rustSpots) {
    const g = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
    g.addColorStop(0, 'rgba(138,74,34,0.30)');
    g.addColorStop(0.5, 'rgba(138,74,34,0.14)');
    g.addColorStop(1, 'rgba(138,74,34,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  for (let i = 0; i < Math.round(22 * area); i++) {
    const x = rng() * w, y = rng() * h, a = rng() * Math.PI, len = 30 + rng() * 120;
    ctx.strokeStyle = `rgba(255,255,255,${0.03 + rng() * 0.05})`;
    ctx.lineWidth = 0.5 + rng() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.9);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// Erodes a solid glyph mask into a torn stencil edge (seeded noise) and
// scatters faint outward speckle (overspray bleed).
function sprayify(draw, ow, oh, rng, opts = {}) {
  const grain = opts.grain ?? 0.5;
  const bleed = opts.bleed ?? 3;
  const off = document.createElement('canvas');
  off.width = ow; off.height = oh;
  const octx = off.getContext('2d');
  draw(octx, ow, oh);
  const src = octx.getImageData(0, 0, ow, oh);
  const out = octx.createImageData(ow, oh);
  const sd = src.data, od = out.data;
  const isSolid = (x, y) => {
    if (x < 0 || y < 0 || x >= ow || y >= oh) return false;
    return sd[(y * ow + x) * 4 + 3] > 60;
  };
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const i = (y * ow + x) * 4;
      const solid = isSolid(x, y);
      let a = 0;
      if (solid) {
        const edge = !isSolid(x - 2, y) || !isSolid(x + 2, y) || !isSolid(x, y - 2) || !isSolid(x, y + 2);
        const n = rng();
        if (edge) a = n > 0.4 ? 255 : Math.floor(n * 255 * 1.6);
        else a = n > grain * 0.08 ? 255 : Math.floor(180 + n * 75);
      } else if (bleed > 0) {
        let near = false;
        for (let dy = -bleed; dy <= bleed && !near; dy++)
          for (let dx = -bleed; dx <= bleed && !near; dx++)
            if (isSolid(x + dx, y + dy)) near = true;
        if (near && rng() < 0.16) a = Math.floor(rng() * 90);
      }
      od[i] = 255; od[i + 1] = 255; od[i + 2] = 255; od[i + 3] = a;
    }
  }
  octx.putImageData(out, 0, 0);
  return off;
}

function tint(canvas, [r, g, b]) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

// Drip anchors are computed in the wordmark's own local (pre-rotation)
// space, then rotated into plate space — but each drip is always drawn
// straight down, because paint obeys gravity regardless of how crooked
// the stencil was held.
function addAngledDrips(ctx, maskCanvas, pivotX, pivotY, angle, color, count, rng) {
  const sctx = maskCanvas.getContext('2d');
  const w = maskCanvas.width, h = maskCanvas.height;
  const data = sctx.getImageData(0, 0, w, h).data;
  const cols = [];
  for (let x = 4; x < w - 4; x += 5) cols.push(x);
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  let placed = 0, attempts = 0;
  while (placed < count && attempts < count * 8) {
    attempts++;
    const cx = cols[Math.floor(rng() * cols.length)];
    let bottom = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (data[(y * w + cx) * 4 + 3] > 120) { bottom = y; break; }
    }
    if (bottom < 0) continue;
    const anchorX = pivotX + cx * cosA - bottom * sinA;
    const anchorY = pivotY + cx * sinA + bottom * cosA;
    const len = 10 + rng() * 46;
    const startW = 1.4 + rng() * 2.2;
    ctx.save();
    ctx.translate(anchorX, anchorY);
    const grad = ctx.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},0.85)`);
    grad.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0.15)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-startW / 2, 0);
    ctx.lineTo(startW / 2, 0);
    ctx.lineTo(startW / 4, len);
    ctx.lineTo(-startW / 4, len);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, len, startW * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.5)`;
    ctx.fill();
    ctx.restore();
    placed++;
  }
}

/**
 * Renders the GAMBITO wordmark onto `canvas`.
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {boolean} [opts.withPlate] - paint the full rusted metal plate behind it (hero use); if false, background stays transparent (drop directly onto existing chrome, e.g. the header bar).
 * @param {number} [opts.fontPx] - glyph size in the canvas's own pixel space.
 * @param {number} [opts.dripCount]
 * @param {number} [opts.pivotXRatio] - wordmark's local (0,0) as a fraction of canvas width.
 * @param {number} [opts.pivotYRatio] - wordmark's local (0,0) as a fraction of canvas height.
 * @param {string} [opts.tagline] - optional second line (e.g. "MULTIPLAYER ARCADE"), sized/spaced relative to fontPx and locked to the same angle/pivot as the wordmark.
 * @param {number} [opts.seed]
 */
export function renderBrandMark(canvas, opts = {}) {
  const {
    withPlate = false,
    fontPx = 100,
    dripCount = 4,
    pivotXRatio = 0.04,
    pivotYRatio = 0.06,
    tagline = null,
    seed = 1337,
  } = opts;
  const rng = mulberry32(seed);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  if (withPlate) paintPlate(ctx, w, h, rng);

  const ow = Math.floor(w * 0.95);
  const oh = Math.round(fontPx * 1.5);
  const drawGlyphs = (octx, ow2, oh2) => {
    octx.font = `900 ${fontPx}px ${FONT_STACK}`;
    octx.textBaseline = 'alphabetic';
    octx.letterSpacing = '2px';
    octx.fillStyle = '#fff';
    octx.fillText('GAMBITO', ow2 * 0.02, oh2 * 0.72);
  };
  const cyanMask = sprayify(drawGlyphs, ow, oh, rng, { grain: 0.7, bleed: 3 });
  const amberMask = sprayify(drawGlyphs, ow, oh, rng, { grain: 0.4, bleed: 2 });
  const cyanLayer = tint(cyanMask, CYAN);
  const amberLayer = tint(amberMask, AMBER);

  // Tagline scales off the same 143px reference the wordmark proportions
  // were originally tuned at, so it sits right whatever fontPx is passed.
  let tagLayer = null, tagLocalX = 0, tagLocalY = 0;
  if (tagline) {
    const scale = fontPx / 143;
    const tagFontPx = Math.round(23 * scale);
    const tow = Math.floor(ow * 0.7), toh = Math.round(60 * scale);
    const drawTag = (octx) => {
      octx.font = `700 ${tagFontPx}px ${FONT_STACK}`;
      octx.textBaseline = 'alphabetic';
      octx.letterSpacing = `${Math.round(10 * scale)}px`;
      octx.fillStyle = '#fff';
      octx.fillText(tagline, 4, toh * 0.7);
    };
    const tagMask = sprayify(drawTag, tow, toh, rng, { grain: 0.5, bleed: 2 });
    tagLayer = tint(tagMask, AMBER_DARK);
    tagLocalX = (ow - tow) / 2;
    tagLocalY = oh * 0.72;
  }

  const pivotX = w * pivotXRatio, pivotY = h * pivotYRatio;

  ctx.save();
  ctx.translate(pivotX, pivotY);
  ctx.rotate(TAG_ANGLE);
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.filter = 'blur(1.5px)';
  ctx.drawImage(cyanLayer, 9, 5);
  ctx.restore();
  ctx.drawImage(amberLayer, 0, 0);
  if (tagLayer) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(tagLayer, tagLocalX, tagLocalY);
    ctx.restore();
  }
  ctx.restore();

  addAngledDrips(ctx, amberMask, pivotX, pivotY, TAG_ANGLE, AMBER_DARK, dripCount, rng);
}
