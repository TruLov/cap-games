'use strict';

/**
 * Integration test — hidden-information projection.
 *
 * Boots the CAP server in-memory via cds.test, connects two WebSocket clients
 * (alice, bob), plays through the start of a Kaiten game, and asserts that an
 * opponent NEVER receives another player's hand (or the draw pile) over the
 * wire, while each player privately receives their own hand.
 */

// cds.test() must be first — before any cds submodule access (docs requirement)
const cds = require('@sap/cds');
const { describe, it, before, after } = require('node:test');
const WebSocket = require('ws');

const cdst = cds.test('.');
const { expect } = cdst;

let port, alice, bob, roomId;

const basic = (u) => 'Basic ' + Buffer.from(`${u}:${u}`).toString('base64');

// --- ws client helpers ----------------------------------------------------
function connect(user) {
  const ws = new WebSocket(`ws://localhost:${port}/ws/play`, { headers: { authorization: basic(user) } });
  const events = [];
  const cursor = {};
  ws.on('message', (m) => events.push(JSON.parse(m.toString())));
  const ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, events, cursor, ready };
}

const send = (c, event, data) => c.ws.send(JSON.stringify({ event, data }));

// Resolves with the next not-yet-consumed event of the given name (waiting if
// necessary). Sequential consumption handles events that arrive back-to-back.
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
  const { server, url } = await cdst; // resolves once cds emits 'listening'
  port = server.address().port;

  // alice creates a kaiten room (she becomes host with symbol X)
  const res = await fetch(`${url}/odata/v4/lobby/createRoom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic('alice') },
    body: JSON.stringify({ game: 'kaiten' }),
  });
  expect(res.status).to.equal(200);
  const body = await res.json();
  roomId = body.value ?? body;
  expect(roomId).to.be.ok;

  alice = connect('alice');
  bob = connect('bob');
  await Promise.all([alice.ready, bob.ready]);
});

after(() => {
  alice?.ws.close();
  bob?.ws.close();
  // cds.test registers its own after() to shut down the server
});

describe('hidden-info projection', () => {

  it('two players join and get distinct symbols', async () => {
    send(alice, 'join', { room: roomId });
    const aJoined = await waitFor(alice, 'joined');
    expect(aJoined.data.symbol).to.equal('X');

    send(bob, 'join', { room: roomId });
    const bJoined = await waitFor(bob, 'joined');
    expect(bJoined.data.symbol).to.equal('O');
  });

  it('start: opponents receive public state only; own hand arrives privately', async () => {
    send(alice, 'configure', { room: roomId, settings: JSON.stringify({ preset: 'classic', players: ['X', 'O'] }) });
    send(alice, 'start', { room: roomId });

    const bStarted = await waitFor(bob, 'started');
    const pub = JSON.parse(bStarted.data.state);

    // public projection: counts yes, contents no
    expect(pub.hands).to.equal(undefined);
    expect(pub.drawPile).to.equal(undefined);
    expect(pub.dessertPool).to.equal(undefined);
    expect(pub.handCounts.X).to.equal(10);
    expect(pub.handCounts.O).to.equal(10);

    // bob privately receives only his own hand
    const bPriv = await waitFor(bob, 'privateState');
    const priv = JSON.parse(bPriv.data.data);
    expect(priv.myHand).to.have.length(10);
    expect(priv.hands).to.equal(undefined);

    // alice likewise receives her own private hand
    const aPriv = await waitFor(alice, 'privateState');
    expect(JSON.parse(aPriv.data.data).myHand).to.have.length(10);
  });

  it('no room-broadcast message ever leaks hands or the draw pile to bob', async () => {
    // make a move so a `moved` public event is produced
    send(alice, 'move', { room: roomId, data: JSON.stringify({ pick: 0 }) });
    send(bob,   'move', { room: roomId, data: JSON.stringify({ pick: 0 }) });
    await waitFor(bob, 'moved');

    const roomEvents = new Set(['started', 'moved', 'finished', 'rematched']);
    for (const e of bob.events.filter(x => roomEvents.has(x.event))) {
      const raw = JSON.stringify(e.data);
      expect(raw).to.not.include('"hands"');
      expect(raw).to.not.include('"drawPile"');
      expect(raw).to.not.include('"pick"');
    }

    // bob's private hand should shrink to 9 once the turn resolves
    let handLen = 10;
    for (let i = 0; i < 4 && handLen !== 9; i++) {
      const p = await waitFor(bob, 'privateState');
      handLen = JSON.parse(p.data.data).myHand.length;
    }
    expect(handLen).to.equal(9);
  });

});
