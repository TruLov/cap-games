/**
 * Integration test - empty room (no game chosen yet).
 *
 * A room can be created without a game ("Open empty room"); players join and
 * wait, then the host picks a game (switchGame) and starts. Verifies the
 * game-less join path (no seat cap, both join as players) + switch + start.
 */

import cds from '@sap/cds';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const cdst = cds.test('.');
const basic = (u) => 'Basic ' + Buffer.from(`${u}:${u}`).toString('base64');

let port, alice, bob, roomId;

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
      if (hits.length > idx) { client.cursor[eventName] = idx + 1; clearInterval(iv); clearTimeout(to); resolve(hits[idx]); }
    };
    const iv = setInterval(poll, 15);
    const to = setTimeout(() => { clearInterval(iv); reject(new Error('timeout waiting for ' + eventName)); }, timeout);
    poll();
  });
}

before(async () => {
  const { server, url } = await cdst;
  port = server.address().port;

  // create an EMPTY room - no game in the body
  const res = await fetch(`${url}/odata/v4/lobby/createRoom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic('alice') },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 200);
  roomId = (await res.json()).value;
  assert.ok(roomId);

  alice = connect('alice');
  bob = connect('bob');
  await Promise.all([alice.ready, bob.ready]);
});

after(() => { alice?.ws.close(); bob?.ws.close(); });

describe('empty room', () => {

  it('created with no game and shows as an empty room in the lobby', async () => {
    const { url } = await cdst;
    const res = await fetch(`${url}/odata/v4/lobby/Rooms?$filter=ID eq '${roomId}'`,
      { headers: { authorization: basic('alice'), accept: 'application/json' } });
    const row = (await res.json()).value[0];
    assert.equal(row.game, '');
    assert.equal(row.gameName, 'Empty room');
  });

  it('both players join a game-less room as players (no seat cap)', async () => {
    send(alice, 'join', { room: roomId });
    const aJ = await waitFor(alice, 'joined');
    assert.equal(aJ.data.spectator, false);
    assert.equal(aJ.data.host, true);

    send(bob, 'join', { room: roomId });
    const bJ = await waitFor(bob, 'joined');
    assert.equal(bJ.data.spectator, false);   // would be a spectator if a 2-max game were set
  });

  it('cannot start before a game is chosen', async () => {
    send(alice, 'start', { room: roomId });
    const err = await waitFor(alice, 'gameError');
    assert.match(err.data.message, /pick a game/i);
  });

  it('host picks a game (switchGame) then starts', async () => {
    send(alice, 'switchGame', { room: roomId, game: 'tictactoe' });
    const sw = await waitFor(bob, 'gameSwitched');
    assert.equal(sw.data.game, 'tictactoe');
    assert.equal(sw.data.name, 'TicTacToe');

    send(alice, 'start', { room: roomId });
    const started = await waitFor(bob, 'started');
    assert.ok(started.data.state);
  });

});
