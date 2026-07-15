const cds = require('@sap/cds');
const registry = require('./registry');

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

      await INSERT.into(Rooms).entries({
        ID: roomId, game, host: user, status: 'lobby', settings: '{}',
      });
      await INSERT.into(Players).entries({
        room_ID: roomId, user, symbol: 'X', isHost: true,
      });

      return roomId;
    });

    await super.init();
  }
}

module.exports = LobbyService;
