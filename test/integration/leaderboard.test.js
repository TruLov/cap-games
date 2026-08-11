/**
 * Integration test - Leaderboard read (ordering + gamertag resolution).
 *
 * The Leaderboard OData entity resolves each row's display gamertag server-side
 * via ProfileService (a cds.connect.to binding). This drives the same GET the
 * leaderboard page uses and asserts points ordering + gamertag labelling, with
 * a fallback to the raw user id when no gamertag is set.
 */

import cds from '@sap/cds';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

const cdst = cds.test('.');
const basic = (u) => 'Basic ' + Buffer.from(`${u}:${u}`).toString('base64');

let url;

before(async () => {
  ({ url } = await cdst);

  // gamertag for alice only; bob stays unlabelled
  await fetch(`${url}/odata/v4/profile/saveGamertag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic('alice') },
    body: JSON.stringify({ gamertag: 'AliceWins' }),
  });

  const { Leaderboard } = cds.entities('cap.games');
  await INSERT.into(Leaderboard).entries([
    { user: 'alice', game: 'kaiten', wins: 12, losses: 3, draws: 1, points: 39 },
    { user: 'bob',   game: 'kaiten', wins: 8,  losses: 4, draws: 2, points: 28 },
    { user: 'carol', game: 'tictactoe', wins: 1, losses: 0, draws: 0, points: 3 },
  ]);
});

describe('leaderboard read', () => {

  it('returns a game filtered, points-ordered ranking with resolved gamertags', async () => {
    const res = await fetch(
      `${url}/odata/v4/lobby/Leaderboard?$filter=game eq 'kaiten'&$orderby=points desc,wins desc`,
      { headers: { authorization: basic('bob'), accept: 'application/json' } },
    );
    assert.equal(res.status, 200);
    const { value } = await res.json();

    // only kaiten rows, highest points first
    assert.deepEqual(value.map(r => r.user), ['alice', 'bob']);
    assert.ok(value.every(r => r.game === 'kaiten'));

    // gamertag resolved for alice, falls back to the id for bob
    assert.equal(value[0].gamertag, 'AliceWins');
    assert.equal(value[1].gamertag, 'bob');

    // record fields intact
    assert.equal(value[0].points, 39);
    assert.equal(value[0].wins, 12);
  });

});
