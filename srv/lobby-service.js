import cds from '@sap/cds';
import * as registry from './registry.js';

class LobbyService extends cds.ApplicationService {
  async init() {
    const { Rooms, Players } = cds.entities('cap.games');

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
    this.after('READ', 'Rooms', async (rooms) => {
      const list = Array.isArray(rooms) ? rooms : rooms ? [rooms] : [];
      if (!list.length) return;

      const ids = [...new Set(list.map(r => r.ID))];
      const counts = await SELECT.from(Players)
        .columns('room_ID', 'count(*) as n')
        .where({ room_ID: { in: ids }, spectator: false })
        .groupBy('room_ID');
      const countByRoom = Object.fromEntries(counts.map(c => [c.room_ID, c.n]));

      for (const r of list) {
        const g = registry.get(r.game);
        r.gameName    = g?.meta.name ?? r.game;
        r.maxPlayers  = g?.meta.maxPlayers ?? null;
        r.playerCount = countByRoom[r.ID] ?? 0;
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
