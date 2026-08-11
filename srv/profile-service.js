import cds from '@sap/cds';

const LOG = cds.log('profile');

const MAX_AVATAR_BYTES = 256 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
// Letters, numbers, spaces, and a few common punctuation marks - enough for
// most gamertags, no HTML/markup, no leading/trailing whitespace surprises.
const GAMERTAG_RE = /^[\p{L}\p{N} _.-]{2,40}$/u;

class ProfileService extends cds.ApplicationService {
  async init() {
    const { Profiles } = cds.entities('cap.games');

    // --------------------------------------------------------- saveGamertag
    this.on('saveGamertag', async (req) => {
      const tag = (req.data.gamertag ?? '').trim();
      if (!GAMERTAG_RE.test(tag))
        return req.error(400, 'Gamertag must be 2-40 characters (letters, numbers, spaces, . _ -)');

      await UPSERT.into(Profiles).entries({ user: req.user.id, gamertag: tag });
      LOG.info('GAMERTAG', req.user.id, '->', tag);
      return tag;
    });

    // ----------------------------------------------------------- saveAvatar
    this.on('saveAvatar', async (req) => {
      const { data, mediaType } = req.data;
      if (!ALLOWED_MIME.has(mediaType))
        return req.error(400, `Unsupported image type: ${mediaType}`);

      let buf;
      try { buf = Buffer.from(data ?? '', 'base64'); }
      catch { return req.error(400, 'Invalid image data'); }

      if (!buf.length) return req.error(400, 'Empty image data');
      if (buf.length > MAX_AVATAR_BYTES)
        return req.error(400, `Image too large - max ${MAX_AVATAR_BYTES / 1024} KB`);

      await UPSERT.into(Profiles).entries({ user: req.user.id, avatar: buf, mediaType });
      LOG.info('AVATAR', req.user.id, `${buf.length} bytes, ${mediaType}`);
      return 'ok';
    });

    // ----------------------------------------------------------- myProfile
    this.on('myProfile', async (req) => {
      // CAP omits LargeBinary/media columns from a bare "select *" (to avoid
      // pulling blobs into ordinary reads) - request `avatar` explicitly or
      // hasAvatar is silently always false.
      const p = await SELECT.one.from(Profiles).columns('user', 'gamertag', 'avatar', 'pinned').where({ user: req.user.id });
      return { gamertag: p?.gamertag ?? '', hasAvatar: !!p?.avatar, pinned: p?.pinned ?? '' };
    });

    // --------------------------------------------------- setPinnedAchievements
    this.on('setPinnedAchievements', async (req) => {
      const { Unlocks } = cds.entities('cap.games');
      let items;
      try { items = JSON.parse(req.data.pinned || '[]'); }
      catch { return req.error(400, 'pinned must be a JSON array'); }
      if (!Array.isArray(items)) return req.error(400, 'pinned must be a JSON array');
      if (items.length > 5) return req.error(400, 'you can pin at most 5 achievements');

      // De-dupe and shape-check before touching the DB.
      const seen = new Set();
      const clean = [];
      for (const it of items) {
        if (!it || typeof it.game !== 'string' || typeof it.id !== 'string') continue;
        const key = `${it.game} ${it.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        clean.push({ game: it.game, id: it.id });
      }

      // Only allow pinning achievements the caller has actually unlocked -
      // otherwise a crafted request could show off unearned badges.
      if (clean.length) {
        const owned = await SELECT.from(Unlocks).columns('id', 'game').where({ user: req.user.id });
        const ownedKeys = new Set(owned.map(o => `${o.game} ${o.id}`));
        const unearned = clean.find(c => !ownedKeys.has(`${c.game} ${c.id}`));
        if (unearned) return req.error(400, `not unlocked: ${unearned.game || 'platform'}/${unearned.id}`);
      }

      const json = JSON.stringify(clean);
      await UPSERT.into(Profiles).entries({ user: req.user.id, pinned: json });
      LOG.info('PINNED', req.user.id, json);
      return json;
    });

    // ---------------------------------------------------------- profilesOf
    this.on('profilesOf', async (req) => {
      const users = [...new Set(req.data.users ?? [])];
      if (!users.length) return [];

      // see myProfile above: avatar must be selected explicitly or it's dropped
      const rows = await SELECT.from(Profiles).columns('user', 'gamertag', 'avatar').where({ user: { in: users } });
      const byUser = Object.fromEntries(rows.map(p => [p.user, p]));
      return users.map(u => ({
        user: u,
        gamertag: byUser[u]?.gamertag ?? '',
        hasAvatar: !!byUser[u]?.avatar,
      }));
    });

    await super.init();
  }
}

export default ProfileService;
