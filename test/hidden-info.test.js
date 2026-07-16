'use strict';

/**
 * Integration test — hidden-information projection.
 *
 * Boots the CAP server in-memory, connects two WebSocket clients (alice, bob),
 * plays through the start of a Sushi Go game, and asserts that an opponent
 * NEVER receives another player's hand (or the draw pile) over the wire, while
 * each player privately receives their own hand.
 *
 * Run: node.exe --test-reporter=tap --test test/hidden-info.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

let child, port, alice, bob, roomId;

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
  // Spawn the real server (same bootstrap as `cds-serve`) on a random port.
  const bin = require.resolve('@sap/cds/bin/serve.js');
  child = spawn(process.execPath, [bin, '--port', '0', '--in-memory'], {
    cwd: __dirname + '/..',
    env: { ...process.env },
  });
  port = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/localhost:(\d+)/);
      if (m) resolve(Number(m[1]));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error('server exited early (' + code + '):\n' + buf)));
    setTimeout(() => reject(new Error('server did not start in time:\n' + buf)), 30000);
  });

  // alice creates a sushigo room (she becomes host with symbol X)
  const res = await fetch(`http://localhost:${port}/odata/v4/lobby/createRoom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: basic('alice') },
    body: JSON.stringify({ game: 'sushigo' }),
  });
  assert.equal(res.status, 200, `createRoom status ${res.status}`);
  const body = await res.json();
  roomId = body.value ?? body;
  assert.ok(roomId, 'room created');

  alice = connect('alice');
  bob = connect('bob');
  await Promise.all([alice.ready, bob.ready]);
});

after(async () => {
  alice?.ws.close();
  bob?.ws.close();
  child?.kill();
});

test('two players join and get distinct symbols', async () => {
  send(alice, 'join', { room: roomId });
  const aJoined = await waitFor(alice, 'joined');
  assert.equal(aJoined.data.symbol, 'X');

  send(bob, 'join', { room: roomId });
  const bJoined = await waitFor(bob, 'joined');
  assert.equal(bJoined.data.symbol, 'O');
});

test('start: opponents receive public state only; own hand arrives privately', async () => {
  send(alice, 'configure', { room: roomId, settings: JSON.stringify({ preset: 'sushi_go', players: ['X', 'O'] }) });
  send(alice, 'start', { room: roomId });

  const bStarted = await waitFor(bob, 'started');
  const pub = JSON.parse(bStarted.data.state);

  // public projection: counts yes, contents no
  assert.equal(pub.hands, undefined, 'public state must not contain hands');
  assert.equal(pub.drawPile, undefined, 'public state must not contain the draw pile');
  assert.equal(pub.dessertPool, undefined, 'public state must not contain the dessert pool');
  assert.equal(pub.handCounts.X, 10);
  assert.equal(pub.handCounts.O, 10);

  // bob privately receives only his own hand
  const bPriv = await waitFor(bob, 'privateState');
  const priv = JSON.parse(bPriv.data.data);
  assert.equal(priv.myHand.length, 10, 'bob gets his 10 cards privately');
  assert.equal(priv.hands, undefined);

  // alice likewise receives her own private hand
  const aPriv = await waitFor(alice, 'privateState');
  assert.equal(JSON.parse(aPriv.data.data).myHand.length, 10);
});

test('no room-broadcast message ever leaks hands or the draw pile to bob', async () => {
  // make a move so a `moved` public event is produced
  send(alice, 'move', { room: roomId, data: JSON.stringify({ pick: 0 }) });
  send(bob, 'move', { room: roomId, data: JSON.stringify({ pick: 0 }) });
  await waitFor(bob, 'moved');

  const roomEvents = new Set(['started', 'moved', 'finished', 'rematched']);
  for (const e of bob.events.filter(x => roomEvents.has(x.event))) {
    const raw = JSON.stringify(e.data);
    assert.ok(!raw.includes('"hands"'), `${e.event} leaked hands`);
    assert.ok(!raw.includes('"drawPile"'), `${e.event} leaked drawPile`);
    assert.ok(!raw.includes('"pick"'), `${e.event} leaked a secret pick`);
  }

  // and bob's private hand should shrink to 9 once the turn resolves
  // (an intermediate 'privateState' is sent while waiting for the other player)
  let handLen = 10;
  for (let i = 0; i < 4 && handLen !== 9; i++) {
    const p = await waitFor(bob, 'privateState');
    handLen = JSON.parse(p.data.data).myHand.length;
  }
  assert.equal(handLen, 9);
});
