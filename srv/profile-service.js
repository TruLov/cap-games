import cds from '@sap/cds';

const LOG = cds.log('profile');

const MAX_AVATAR_BYTES = 256 * 1024;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
// Letters, numbers, spaces, and a few common punctuation marks — enough for
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
        return req.error(400, `Image too large — max ${MAX_AVATAR_BYTES / 1024} KB`);

      await UPSERT.into(Profiles).entries({ user: req.user.id, avatar: buf, mediaType });
      LOG.info('AVATAR', req.user.id, `${buf.length} bytes, ${mediaType}`);
      return 'ok';
    });

    // ----------------------------------------------------------- myProfile
    this.on('myProfile', async (req) => {
      // CAP omits LargeBinary/media columns from a bare "select *" (to avoid
      // pulling blobs into ordinary reads) — request `avatar` explicitly or
      // hasAvatar is silently always false.
      const p = await SELECT.one.from(Profiles).columns('user', 'gamertag', 'avatar').where({ user: req.user.id });
      return { gamertag: p?.gamertag ?? '', hasAvatar: !!p?.avatar };
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
