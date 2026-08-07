/**
 * profile-edit.js — the "Edit profile" page (gamertag + avatar).
 *
 * Includes a client-side image resize before upload: rather than relying solely
 * on the server rejecting an oversized image, downscale to a small square and
 * re-encode as JPEG (shrinking quality until it fits), so the user gets a usable
 * avatar instead of an error. Extracted from platform.js as a self-contained
 * feature; wired via initProfileEditing(ctx) with the handful of shell services
 * it needs (profile cache, OData call, header helpers, view switch).
 */

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
 *   initials, getUserId, toast, showView
 * Returns { showProfilePage } for the account menu's "Edit profile" entry.
 */
export function initProfileEditing(ctx) {
  const { $, serviceCall, profiles, ensureProfiles, nameOf, avatarUrlOf, initials, getUserId, toast, showView } = ctx;
  let pendingAvatarBlob = null;

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

  function showProfilePage() {
    pendingAvatarBlob = null;
    $('profile-gamertag-input').value = profiles.get(getUserId())?.gamertag ?? '';
    renderProfileAvatarPreview();
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
      profiles.delete(getUserId());
      await ensureProfiles([getUserId()]);
      toast('Profile saved');
      showView('lobby');
    } catch (e) {
      toast(e.message || 'Could not save profile');
    }
  };

  $('profile-back-btn').onclick = () => showView('lobby');

  return { showProfilePage };
}
