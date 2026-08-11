/**
 * shell/util.js - small shared UI helpers.
 */

/**
 * Short display label for a user id, since the platform no longer assigns
 * player symbols. 'darrell.abbott' → 'DA', 'alice' → 'AL'.
 */
export function initials(userId = '') {
  const parts = String(userId).split(/[.\-_@\s]+/).filter(Boolean);
  const chars = parts.length >= 2
    ? parts[0][0] + parts[1][0]
    : (parts[0] ?? String(userId)).slice(0, 2);
  return chars.toUpperCase();
}
