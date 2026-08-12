/**
 * profile-edit.js - the "Edit profile" page (gamertag + avatar + pinned
 * achievement badges).
 *
 * Includes a client-side image resize before upload: rather than relying solely
 * on the server rejecting an oversized image, downscale to a small square and
 * re-encode as JPEG (shrinking quality until it fits), so the user gets a usable
 * avatar instead of an error. Extracted from platform.js as a self-contained
 * feature; wired via initProfileEditing(ctx) with the handful of shell services
 * it needs (profile cache, OData call, header helpers, view switch).
 *
 * The achievement picker lets the player choose up to 5 of their OWNED
 * achievements to pin on the rail badge row (see platform.js loadRailStats) -
 * leaving the pin empty falls back to their 5 most recently unlocked.
 */

import { achievementIcon, achievementColor } from './achievement-icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MAX_PINS = 5;
const pinKey = (a) => `${a.game} ${a.id}`;

// Downscale to a small square and re-encode as JPEG, lowering quality until the
// result fits under maxBytes.
export async function resizeImageToLimit(file, maxBytes = 256 * 1024, maxDim = 256) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);

  let quality = 0.85;
  for (let i = 0; i < 6; i++) {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (blob.size <= maxBytes || quality <= 0.3) return blob;
    quality -= 0.15;
  }
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.3));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Wire the profile page's inputs/buttons. `ctx` supplies the shell services the
 * page depends on:
 *   $, serviceCall, profiles (Map), ensureProfiles, nameOf, avatarUrlOf,
 *   initials, getUserId, toast, showView, onSaved (optional - called after a
 *   successful save so the shell can refresh anything cached, e.g. the rail
 *   badge row)
 * Returns { showProfilePage } for the account menu's "Edit profile" entry.
 */
export function initProfileEditing(ctx) {
  const { $, serviceCall, profiles, ensureProfiles, nameOf, avatarUrlOf, initials, getUserId, toast, showView, onSaved } = ctx;
  let pendingAvatarBlob = null;
  let ownedAchievements = [];   // [{ game, id, name, desc, at }] - this user's owned achievements
  let selectedPins = [];        // [{ game, id }] - up to MAX_PINS, in pick order

  function renderProfileAvatarPreview() {
    const el = $('profile-avatar-preview');
    if (pendingAvatarBlob) {
      el.innerHTML = `<img src="${URL.createObjectURL(pendingAvatarBlob)}" alt="">`;
      return;
    }
    const url = avatarUrlOf(getUserId());
    el.innerHTML = url ? `<img src="${url}" alt="">` : '';
    if (!url) el.textContent = initials(nameOf(getUserId()));
  }

  function renderAchPicker() {
    const root = $('profile-ach-picker');
    if (!ownedAchievements.length) {
      root.innerHTML = '<div class="sh-small">No achievements yet - go win something.</div>';
      return;
    }
    const selectedKeys = new Set(selectedPins.map(pinKey));
    root.innerHTML = ownedAchievements.map(a => {
      const on = selectedKeys.has(pinKey(a));
      return `<button type="button" class="ach-badge ach-badge-pick${on ? ' on' : ''}"
        data-game="${esc(a.game)}" data-id="${esc(a.id)}"
        style="color:${achievementColor(a.game)}" title="${esc(a.name)}">${achievementIcon(a.game, a.id)}</button>`;
    }).join('');
    root.querySelectorAll('button[data-id]').forEach(b =>
      b.onclick = () => togglePin(b.dataset.game, b.dataset.id));
  }

  function togglePin(game, id) {
    const key = `${game} ${id}`;
    const idx = selectedPins.findIndex(p => pinKey(p) === key);
    if (idx >= 0) {
      selectedPins.splice(idx, 1);
    } else {
      if (selectedPins.length >= MAX_PINS) { toast(`You can pin at most ${MAX_PINS} achievements`); return; }
      selectedPins.push({ game, id });
    }
    renderAchPicker();
  }

  async function loadAchPicker() {
    try {
      const [{ value: achRows }, profile] = await Promise.all([
        serviceCall('lobby', 'GET', 'myAchievements()'),
        serviceCall('profile', 'GET', 'myProfile()'),
      ]);
      ownedAchievements = (achRows ?? []).flatMap(g => (g.owned ?? []).map(a => ({ ...a, game: g.game })));

      let pins;
      try { pins = JSON.parse(profile?.pinned || '[]'); } catch { pins = []; }
      const ownedKeys = new Set(ownedAchievements.map(pinKey));
      selectedPins = (Array.isArray(pins) ? pins : []).filter(p => ownedKeys.has(pinKey(p)));
    } catch {
      ownedAchievements = [];
      selectedPins = [];
    }
    renderAchPicker();
  }

  function showProfilePage() {
    pendingAvatarBlob = null;
    $('profile-gamertag-input').value = profiles.get(getUserId())?.gamertag ?? '';
    renderProfileAvatarPreview();
    $('profile-ach-picker').innerHTML = '<div class="sh-small">Loading…</div>';
    loadAchPicker();
    showView('profile');
  }

  $('profile-avatar-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingAvatarBlob = await resizeImageToLimit(file);
      renderProfileAvatarPreview();
    } catch { toast('Could not read that image'); }
  };

  $('profile-save-btn').onclick = async () => {
    const tag = $('profile-gamertag-input').value.trim();
    try {
      if (tag) await serviceCall('profile', 'POST', 'saveGamertag', { gamertag: tag });
      if (pendingAvatarBlob) {
        const data = await blobToBase64(pendingAvatarBlob);
        await serviceCall('profile', 'POST', 'saveAvatar', { data, mediaType: 'image/jpeg' });
        pendingAvatarBlob = null;
      }
      await serviceCall('profile', 'POST', 'setPinnedAchievements', { pinned: JSON.stringify(selectedPins) });
      profiles.delete(getUserId());
      await ensureProfiles([getUserId()]);
      renderProfileAvatarPreview();
      toast('Profile saved');
      onSaved?.();
    } catch (e) {
      toast(e.message || 'Could not save profile');
    }
  };

  $('profile-back-btn').onclick = () => showView('lobby');

  return { showProfilePage };
}
