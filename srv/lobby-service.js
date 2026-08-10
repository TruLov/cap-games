import cds from '@sap/cds';
import * as registry from './registry.js';
import * as ach from './achievements.js';

class LobbyService extends cds.ApplicationService {
  async init() {
    const { Rooms, Players } = cds.entities('cap.games');

    // Consume ProfileService through the service binding, not by importing its
    // impl: `cds.connect.to` resolves it via `cds.requires`, so it's the same
    // call whether ProfileService is in-process (today) or a remote binding
    // later — LobbyService stays agnostic to where it lives.
    const profiles = await cds.connect.to('ProfileService');

    // --- Leaderboard: decorate rows with the display gamertag (see .cds) ---
    this.after('READ', 'Leaderboard', async (rows) => {
      const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
      if (!list.length) return;

      const users = [...new Set(list.map(r => r.user))];
      const resolved = await profiles.send('profilesOf', { users });
      const byUser = Object.fromEntries((resolved ?? []).map(p => [p.user, p.gamertag]));

      for (const r of list) r.gamertag = byUser[r.user] || r.user;
    });

    // --- Games catalogue (virtual, from registry) ---
    this.on('READ', 'Games', () => {
      return Object.entries(registry.all()).map(([id, g]) => ({
        id,
        name:       g.meta.name,
        minPlayers: g.meta.minPlayers,
        maxPlayers: g.meta.maxPlayers,
      }));
    });

    // --- Rooms: decorate with gameName/playerCount/maxPlayers so the start
    // page can list open rooms with a headcount (see lobby-service.cds) ---
    this.after('READ', 'Rooms', async (rooms, req) => {
      const list = Array.isArray(rooms) ? rooms : rooms ? [rooms] : [];
      if (!list.length) return;

      // One round trip for both the per-room headcount and whether the caller
      // already has a seat (see below) — was two separate queries.
      const ids = [...new Set(list.map(r => r.ID))];
      const members = await SELECT.from(Players)
        .columns('room_ID', 'user', 'spectator')
        .where({ room_ID: { in: ids } });

      const countByRoom = {};
      const memberOf = new Set();
      for (const p of members) {
        if (!p.spectator) countByRoom[p.room_ID] = (countByRoom[p.room_ID] ?? 0) + 1;
        // Rooms the caller already has a seat in — the start page shows
        // "Reconnect" instead of "Join"/"Spectate" for these (matters after a
        // disconnect: the room may look "full" from the outside, but that seat
        // is the caller's own).
        if (p.user === req.user.id) memberOf.add(p.room_ID);
      }

      for (const r of list) {
        const g = registry.get(r.game);
        r.gameName    = g?.meta.name ?? r.game;
        r.maxPlayers  = g?.meta.maxPlayers ?? null;
        r.playerCount = countByRoom[r.ID] ?? 0;
        r.isMember    = memberOf.has(r.ID);
      }
    });

    // --- createRoom ---
    this.on('createRoom', async (req) => {
      const { game } = req.data;
      const user = req.user.id;

      if (!registry.get(game))
        return req.error(400, `Unknown game: ${game}`);

      const roomId = cds.utils.uuid();
      const code   = await this._uniqueCode();

      await INSERT.into(Rooms).entries({
        ID: roomId, game, host: user, status: 'lobby', settings: '{}', code,
      });
      await INSERT.into(Players).entries({
        room_ID: roomId, user, spectator: false, isHost: true,
      });

      return roomId;
    });

    // --- myAchievements: caller's unlocks grouped by game (see .cds) ---
    // Only OWNED entries + a per-game total leave the server; locked
    // definitions are never disclosed.
    this.on('myAchievements', async (req) => {
      const { Unlocks } = cds.entities('cap.games');
      const owned = await SELECT.from(Unlocks).where({ user: req.user.id });

      const byGame = {};
      for (const u of owned) (byGame[u.game] ??= []).push(u);

      const cat = ach.catalogue();
      return Object.entries(cat).map(([game, c]) => ({
        game,
        gameName: c.name,
        total: Object.keys(c.defs).length,
        owned: (byGame[game] ?? [])
          .filter(u => c.defs[u.id])   // ignore unlocks whose definition is gone
          .map(u => ({ id: u.id, ...ach.label(game, u.id), at: u.at }))
          .sort((a, b) => (a.at < b.at ? -1 : 1)),
      }));
    });

    // --- whoami: the caller's platform identity ---
    this.on('whoami', (req) => req.user.id);

    await super.init();
  }

  // Generate a unique 4-char alphanumeric room code (retry on collision).
  async _uniqueCode() {
    const { Rooms } = cds.entities('cap.games');
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 4 }, () => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
      const existing = await SELECT.one.from(Rooms).where({ code });
      if (!existing) return code;
    }
    throw new Error('Could not generate a unique room code — try again');
  }
}

export default LobbyService;
