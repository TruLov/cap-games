/**
 * Integration test — achievement slice (end-to-end through the real WS path).
 *
 * Boots the CAP server in-memory, plays a full TicTacToe match to a win by the
 * SECOND player (bob = O), and asserts:
 *   - the winner is privately notified via `achievementUnlocked`,
 *   - both the game-declared ('underdog', pure) and platform meta ('firstWin',
 *     aggregate) achievements fire,
 *   - they are persisted in Unlocks (game-scoped vs. platform-wide game=''),
 *   - the loser (alice) unlocks nothing.
 */

// cds.test() must be first — before any cds submodule access (docs requirement)
import cds from '@sap/cds';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const cdst = cds.test('.');

let port, alice, bob, roomId;

const basic = (u) => 'Basic ' + Buffer.from(`${u}:${u}`).toString('base64');

function connect(user) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/play`, { headers: { authorization: basic(user) } });
  const events = [];
  const cursor = {};
  ws.on('message', (m) => events.push(JSON.parse(m.toString())));
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, events, cursor, ready };
}

const send = (c, event, data) => c.ws.send(JSON.stringify({ event, data }));

function waitFor(client, eventName, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const idx = client.cursor[eventName] ?? 0;
    const poll = () => {
      const hits = client.events.filter(e => e.event === eventName);
      if (hits.length > idx) {
        client.cursor[eventName] = idx + 1;
        clearInterval(iv); clearTimeout(to);
        resolve(hits[idx]);
      }
    };
    const iv = setInterval(poll, 15);
    const to = setTimeout(() => { clearInterval(iv); reject(new Error('timeout waiting for ' + eventName)); }, timeout);
    poll();
  });
}

before(async () => {
  const { server, url } = await cdst;
  port = server.address().port;

  const res = await fetch(`${url}/odata/v4/lobby/createRoom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic('alice') },
    body: JSON.stringify({ game: 'tictactoe' }),
  });
  assert.equal(res.status, 200);
  roomId = (await res.json()).value;
  assert.ok(roomId);

  alice = connect('alice');
  bob = connect('bob');
  await Promise.all([alice.ready, bob.ready]);
});

after(() => { alice?.ws.close(); bob?.ws.close(); });

describe('achievement slice', () => {

  it('awards + notifies + persists on a match win by the second player (O)', async () => {
    // alice (host, X) and bob (O) join
    send(alice, 'join', { room: roomId });
    await waitFor(alice, 'joined');
    send(bob, 'join', { room: roomId });
    await waitFor(bob, 'joined');

    // alice defaults to first (X); start the match
    send(alice, 'start', { room: roomId });
    await waitFor(bob, 'started');

    // Drive bob (O) to a top-row win while alice (X) never lines up:
    //   X:3  O:0  X:4  O:1  X:6  O:2 -> O wins 0,1,2
    // Serialize on `moved` so each move lands before the next (turn validation).
    const moves = [
      [alice, 3], [bob, 0], [alice, 4], [bob, 1], [alice, 6], [bob, 2],
    ];
    for (let i = 0; i < moves.length; i++) {
      const [who, cell] = moves[i];
      send(who, 'move', { room: roomId, data: JSON.stringify({ cell }) });
      if (i < moves.length - 1) await waitFor(bob, 'moved');
    }

    const fin = await waitFor(bob, 'finished');
    assert.equal(fin.data.winner, 'bob');

    // bob is privately notified of his unlocks
    const evt = await waitFor(bob, 'achievementUnlocked');
    const unlocked = JSON.parse(evt.data.unlocked);
    const ids = unlocked.map(u => u.id).sort();
    assert.deepEqual(ids, ['firstWin', 'underdog']);
    // payload carries display metadata for the toast
    assert.ok(unlocked.every(u => u.name && typeof u.name === 'string'));

    // persisted: game-declared is game-scoped, meta is game=''
    const { Unlocks } = cds.entities('cap.games');
    const rows = await SELECT.from(Unlocks).where({ user: 'bob' });
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));
    assert.equal(byId.underdog.game, 'tictactoe');
    assert.equal(byId.firstWin.game, '');

    // the loser unlocks nothing
    const aliceRows = await SELECT.from(Unlocks).where({ user: 'alice' });
    assert.equal(aliceRows.length, 0);
  });

  it('browse (myAchievements) shows owned in full + counts, never leaks locked', async () => {
    const url = (await cdst).url;
    const call = (u) => fetch(`${url}/odata/v4/lobby/myAchievements()`, {
      headers: { authorization: basic(u) },
    }).then(r => r.json());

    // bob owns underdog (tictactoe) + firstWin (platform)
    const bob = (await call('bob')).value;
    const tttB = bob.find(g => g.game === 'tictactoe');
    const platB = bob.find(g => g.game === '');
    assert.deepEqual(tttB.owned.map(a => a.id), ['underdog']);
    assert.equal(tttB.total, 1);
    assert.ok(platB.owned.some(a => a.id === 'firstWin'));
    // allGames is defined but NOT owned → only reflected in the count (left = 1)
    assert.equal(platB.total - platB.owned.length, 1);
    assert.ok(!platB.owned.some(a => a.id === 'allGames'));

    // carol owns nothing → empty owned lists, totals present, and crucially
    // the payload discloses NO locked names/descriptions.
    const carol = (await call('carol')).value;
    assert.ok(carol.every(g => g.owned.length === 0));
    assert.ok(carol.some(g => g.total > 0));
    const raw = JSON.stringify(carol);
    for (const leak of ['underdog', 'Underdog', 'First Blood', 'Sampler', 'Win a match as O']) {
      assert.ok(!raw.includes(leak), `locked achievement leaked to non-owner: ${leak}`);
    }
  });

});
