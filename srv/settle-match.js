import cds from '@sap/cds';
import * as eng from './engine.js';
import * as reg from './registry.js';
import * as ach from './achievements.js';

const LOG = cds.log('game');

/**
 * settleMatch - everything that happens once a match ends: persist the
 * Matches row, dispatch scoring into Leaderboard, and award/notify
 * achievements. Reached from two call sites in play-service.js - a real
 * 'move' that returns `result.end`, and a server-driven tick that returns
 * `res.end` (mttt's blitz onTick) - both funnel through this one interface
 * instead of two inlined copies of the same bookkeeping.
 *
 * `srv` only needs `.emit()` (the private achievementUnlocked notice) -
 * settleMatch is a plain function, not a service extension, so it stays
 * testable without a WebSocket.
 */
async function settleMatch(srv, { room, roomId, result, players }) {
  const { Matches, Leaderboard } = cds.entities('cap.games');

  await INSERT.into(Matches).entries({
    game: room.game,
    room: roomId,
    winner: result.end.winner,
    players: JSON.stringify(players.map(p => ({ user: p.user, spectator: p.spectator }))),
    state: JSON.stringify(eng.getBoard(roomId)?.state ?? {}),
  });

  const game = reg.get(room.game);
  const scores = typeof game.score === 'function'
    ? game.score(result.end, players)
    : eng.defaultScore(result.end, players,
        game.pointsOf ? { pointsOf: u => game.pointsOf(result.end, u) } : {});

  for (const s of scores) {
    // DB-side increments instead of read-modify-write: avoids a lost update
    // if two matches for the same user/game finish concurrently. The
    // returned affected-row count tells us whether a row existed to bump;
    // if not, insert the first one. (Plain UPDATE against the db - not
    // through a service - returns a bare number, not `{ affected }`.)
    const winsDelta   = s.result === 'win'  ? 1 : 0;
    const lossesDelta = s.result === 'loss' ? 1 : 0;
    const drawsDelta  = s.result === 'draw' ? 1 : 0;
    const pointsDelta = s.points ?? 0;

    const affected = await UPDATE(Leaderboard)
      .set({
        wins:   { '+=': winsDelta },
        losses: { '+=': lossesDelta },
        draws:  { '+=': drawsDelta },
        points: { '+=': pointsDelta },
      })
      .where({ user: s.user, game: room.game });

    if (!affected) {
      await INSERT.into(Leaderboard).entries({
        user: s.user, game: room.game,
        wins:   winsDelta,
        losses: lossesDelta,
        draws:  drawsDelta,
        points: pointsDelta,
      });
    }
  }

  await awardAchievements(srv, room.game, roomId, result.end, players);
}

// Evaluate + persist achievements for every player of a finished match, then
// privately notify anyone who unlocked something. Runs after Leaderboard is
// updated so the meta (aggregate) tier sees this match. Sources:
//   A. game.checkAchievements - single-match, pure (per game)
//   B. ach.evaluateMeta       - cross-game aggregate (platform)
async function awardAchievements(srv, gameId, roomId, end, players) {
  const { Unlocks } = cds.entities('cap.games');
  const game = reg.get(gameId);
  const state = eng.getBoard(roomId)?.state ?? {};

  for (const p of players.filter(pl => !pl.spectator)) {
    const candidates = [
      ...(game.checkAchievements?.(end, state, p.user) ?? []).map(id => ({ id, game: gameId })),
      ...(await ach.evaluateMeta({ user: p.user, end })).map(id => ({ id, game: '' })),
    ];

    if (!candidates.length) continue;

    // One lookup for all of this player's existing unlocks instead of a
    // SELECT per candidate.
    const owned = await SELECT.from(Unlocks).columns('id', 'game').where({ user: p.user });
    const ownedKeys = new Set(owned.map(o => `${o.game} ${o.id}`));

    const fresh = [];
    for (const c of candidates) {
      if (ownedKeys.has(`${c.game} ${c.id}`)) continue;
      ownedKeys.add(`${c.game} ${c.id}`); // dedupe within this batch too
      await INSERT.into(Unlocks).entries({ user: p.user, id: c.id, game: c.game, at: new Date().toISOString() });
      fresh.push({ id: c.id, game: c.game, ...ach.label(c.game, c.id) });
    }

    if (fresh.length) {
      LOG.info('ACHIEVEMENT', p.user, fresh.map(f => f.id).join(','));
      await srv.emit('achievementUnlocked', { unlocked: JSON.stringify(fresh) }, { user: { include: [p.user] } });
    }
  }
}

export { settleMatch };
