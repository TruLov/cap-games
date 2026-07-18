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
        room_ID: roomId, user, symbol: 'X', isHost: true,
      });

      return roomId;
    });

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
