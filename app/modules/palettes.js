/**
 * palettes.js - named color-palette picker (Appearance section, profile page).
 *
 * The actual color *values* for each palette live in style.css as
 * [data-palette][data-theme] blocks (same variable names as the base theme,
 * same pattern as theme.js's [data-theme]) - this file only holds the
 * registry that drives the picker (id, display name, a 3-color preview
 * swatch) plus the apply/persist logic. index.html/logout.html set the
 * initial value inline before first paint (no flash); this wires runtime
 * switching + persistence, mirroring theme.js.
 *
 * The picker is a custom dropdown rather than a native <select> so each row
 * can show its own swatches and hovering can live-preview the whole page -
 * neither is reliably stylable/scriptable on a native <option>. Hovering a
 * row previews it (sets the CSS vars without persisting); moving off the
 * menu without picking reverts to the committed palette; clicking a row
 * commits it (persists + closes).
 *
 * To add a palette later: pick an id, add its dark + light CSS blocks in
 * style.css under that [data-palette="id"], then add one entry below.
 */
export const PALETTES = [
  { id: 'cold-brew',      name: 'Cold Brew',          swatch: ['#221f1c', '#8a9a6b', '#E7E1D6'] },
  { id: 'macchiato',      name: 'Macchiato Contrast', swatch: ['#43301f', '#b9765a', '#F0E4D6'] },
  { id: 'straight-black', name: 'Straight Black',     swatch: ['#221710', '#9c6b52', '#ECE0D0'] },
  { id: 'oat-milk',       name: 'Oat Milk',           swatch: ['#2c2118', '#cf9a5c', '#F6EEE1'] },
  { id: 'roasted-slate',  name: 'Roasted Slate',      swatch: ['#38220F', '#d97f3f', '#ECE0D0'] },
];
const DEFAULT_PALETTE = 'cold-brew';

const paletteOf = id => PALETTES.find(p => p.id === id) ?? PALETTES[0];
const swatchHtml = p => p.swatch.map(c => `<i style="background:${c}"></i>`).join('');

function commit(id) {
  document.documentElement.dataset.palette = id;
  localStorage.setItem('palette', id);
}
function preview(id) { document.documentElement.dataset.palette = id; }

// Wire the profile page's palette dropdown and sync it to the inline
// pre-paint choice. `$` is the shell's id-lookup helper.
export function initPalette($) {
  commit(document.documentElement.dataset.palette || DEFAULT_PALETTE);

  const root  = $('pal-picker');
  const btn   = $('pal-picker-btn');
  const label = $('pal-picker-label');
  const swAll = $('pal-picker-swatches');
  const menu  = $('pal-picker-menu');
  if (!root || !btn || !menu) return;

  let committedId = document.documentElement.dataset.palette;

  function renderButton() {
    const p = paletteOf(committedId);
    label.textContent = p.name;
    swAll.innerHTML = swatchHtml(p);
  }

  function renderMenu() {
    menu.innerHTML = PALETTES.map(p =>
      `<button type="button" class="pal-option${p.id === committedId ? ' on' : ''}" data-id="${p.id}">` +
      `<span class="pal-swatches">${swatchHtml(p)}</span><span>${p.name}</span></button>`
    ).join('');
    menu.querySelectorAll('.pal-option').forEach(row => {
      row.onmouseenter = () => preview(row.dataset.id);
      row.onclick = () => { committedId = row.dataset.id; commit(committedId); renderButton(); close(); };
    });
    menu.onmouseleave = () => preview(committedId);
  }

  function open()  { renderMenu(); menu.hidden = false; }
  function close() { menu.hidden = true; preview(committedId); }
  function toggle() { menu.hidden ? open() : close(); }

  btn.onclick = toggle;
  document.addEventListener('click', e => { if (!menu.hidden && !root.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) close(); });

  renderButton();
}
