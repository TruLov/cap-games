import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { init, applyMove, classify } from '../lib/tree.js';
import { treeBuilder } from '../lib/ai-static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenarioFile = JSON.parse(readFileSync(join(__dirname, '../db/data/nebelmine.json'), 'utf8'));
const scenario = { ...scenarioFile };   // roles/tree already parsed objects in the file

const party = [
  { symbol: 'X', user: 'alice', isHost: true },
  { symbol: 'O', user: 'bob' },
  { symbol: 'A', user: 'carol' },
];
const profiles = {
  alice: 'packt Probleme mit roher Kraft an',
  bob:   'neugierig, redet sich gern raus',
};
const chronicles = {
  carol: ['Hat ein antikes Rätsel im Alleingang gelöst (ist klug geworden)'],
};

const freshSettings = (seed = 42) =>
  treeBuilder({ scenario, party, profiles, chronicles, seed });

// --------------------------------------------------------------- treeBuilder

test('treeBuilder casts roles from archetype/chronicle keywords', () => {
  const s = freshSettings();
  assert.equal(s.casting.X.role, 'Schmied:in mit Vorschlaghammer');   // 'kraft'
  assert.equal(s.casting.O.role, 'Unterhändler:in des Dorfes');       // 'reden'
  assert.equal(s.casting.A.role, 'Kräuterkundige:r');                 // 'klug'
  assert.equal(new Set(Object.values(s.casting).map(c => c.role)).size, 3);
});

test('treeBuilder resolves roll/moment actors and bonuses into the tree', () => {
  const s = freshSettings();
  for (const n of Object.values(s.tree.nodes)) {
    if (n.mechanic === 'roll') {
      assert.ok(s.party.some(p => p.symbol === n.roll.symbol), `${n.roll.castHint} resolved`);
      assert.equal(typeof n.roll.bonus, 'number');
    }
    if (n.mechanic === 'moment')
      assert.ok(s.party.some(p => p.symbol === n.symbol));
  }
  // 'tor' wants someone strong — alice's archetype contains 'kraft' → +2 bonus
  assert.equal(s.tree.nodes.tor.roll.symbol, 'X');
  assert.equal(s.tree.nodes.tor.roll.bonus, 2);
});

// ---------------------------------------------------------------------- init

test('init builds a playable state; log opens with scene 1', () => {
  const state = init(freshSettings());
  assert.equal(state.turn, 'all');
  assert.equal(state.phase, 'playing');
  assert.equal(state.nodeId, 'eingang');
  assert.equal(state.host, 'X');
  assert.deepEqual(state.symbols, ['X', 'O', 'A']);
  assert.equal(state.log[0].kind, 'scene');
  assert.equal(state.log[0].scene, 1);
});

test('init rejects missing prepare output', () => {
  assert.throws(() => init({}), /prepare/);
  assert.throws(() => init({ party, tree: {} }), /decision tree/);
});

// ---------------------------------------------------------------------- vote

test('vote buffers until everyone voted, then majority wins', () => {
  const state = init(freshSettings());
  let r = applyMove(state, { type: 'vote', option: 1 }, 'X');
  assert.equal(r.end, null);
  assert.equal(state.nodeId, 'eingang');           // still waiting
  r = applyMove(state, { type: 'vote', option: 0 }, 'O');
  r = applyMove(state, { type: 'vote', option: 1 }, 'A');
  assert.equal(state.nodeId, 'schacht');           // majority: Lüftungsschacht
  assert.equal(r.end, null);
  assert.deepEqual(state.votes, {});               // buffer cleared
});

test('vote tie resolves via deterministic coin flip', () => {
  const two = party.slice(0, 2);
  const settings = treeBuilder({ scenario, party: two, profiles, chronicles, seed: 7 });
  const a = init({ ...settings, seed: 7 });
  applyMove(a, { type: 'vote', option: 0 }, 'X');
  applyMove(a, { type: 'vote', option: 1 }, 'O');
  assert.ok(['tor', 'schacht'].includes(a.nodeId));
  const b = init({ ...settings, seed: 7 });         // same seed → same flip
  applyMove(b, { type: 'vote', option: 0 }, 'X');
  applyMove(b, { type: 'vote', option: 1 }, 'O');
  assert.equal(a.nodeId, b.nodeId);
});

test('forceVote: host only, resolves with cast votes', () => {
  const state = init(freshSettings());
  assert.ok(applyMove(state, { type: 'forceVote' }, 'O').error);   // not host
  applyMove(state, { type: 'vote', option: 0 }, 'O');
  const r = applyMove(state, { type: 'forceVote' }, 'X');
  assert.equal(r.error, undefined);
  assert.equal(state.nodeId, 'tor');               // the single cast vote wins
});

test('invalid votes are rejected', () => {
  const state = init(freshSettings());
  assert.ok(applyMove(state, { type: 'vote', option: 9 }, 'X').error);
  assert.ok(applyMove(state, { type: 'vote', option: 0 }, 'spectator').error);
  assert.ok(applyMove(state, { type: 'roll' }, 'X').error);        // wrong mechanic
});

// ---------------------------------------------------------------------- roll

test('roll: named player only, deterministic d20, branches on target', () => {
  const state = init(freshSettings());
  for (const s of ['X', 'O', 'A']) applyMove(state, { type: 'vote', option: 0 }, s);
  assert.equal(state.nodeId, 'tor');
  const roller = state.tree.nodes.tor.roll.symbol;
  const other = state.symbols.find(s => s !== roller);
  assert.ok(applyMove(state, { type: 'roll' }, other).error);
  const r = applyMove(state, { type: 'roll' }, roller);
  assert.equal(r.error, undefined);
  const entry = state.log.find(e => e.kind === 'roll');
  assert.ok(entry.die >= 1 && entry.die <= 20);
  assert.equal(entry.total, entry.die + entry.bonus);
  assert.equal(entry.success, entry.total >= entry.target);
  assert.equal(state.nodeId, 'wesen');             // both branches lead there
});

// -------------------------------------------------------------------- moment

test('classify maps free text onto predefined options', () => {
  const options = scenario.tree.nodes.wesen.options;
  assert.equal(classify('Ich biete ihm meinen Hammer als Geschenk an', options), 0);  // Verhandeln
  assert.equal(classify('Weg da, du Nebelklops, sonst gibt es Ärger!', options), 1);  // Einschüchtern
  assert.equal(classify('Ich werfe die Laterne als Ablenkung', options), 2);          // Ablenken
  assert.equal(classify('ähm. hallo?', options), 0);                                  // fallback: first
});

test('moment: named player, text limit, logs the quote', () => {
  const state = init(freshSettings());
  for (const s of ['X', 'O', 'A']) applyMove(state, { type: 'vote', option: 0 }, s);
  applyMove(state, { type: 'roll' }, state.tree.nodes.tor.roll.symbol);
  assert.equal(state.nodeId, 'wesen');
  const actor = state.tree.nodes.wesen.symbol;
  const other = state.symbols.find(s => s !== actor);
  assert.ok(applyMove(state, { type: 'moment', text: 'hi' }, other).error);
  assert.ok(applyMove(state, { type: 'moment', text: 'x'.repeat(141) }, actor).error);
  const r = applyMove(state, { type: 'moment', text: 'Ich biete dir Frieden und ein Geschenk' }, actor);
  assert.equal(r.error, undefined);
  assert.ok(state.log.some(e => e.kind === 'moment' && e.by === actor));
  assert.equal(state.nodeId, 'quelle');            // Verhandeln branch
});

// ------------------------------------------------------------ full playthrough

function drive(state) {
  for (let i = 0; i < 50; i++) {
    const n = state.tree.nodes[state.nodeId];
    let r;
    if (n.mechanic === 'vote') {
      for (const s of state.symbols) r = applyMove(state, { type: 'vote', option: 0 }, s);
    } else if (n.mechanic === 'roll') {
      r = applyMove(state, { type: 'roll' }, n.roll.symbol);
    } else if (n.mechanic === 'moment') {
      r = applyMove(state, { type: 'moment', text: 'Ich biete dir ein Geschenk, Frieden!' }, n.symbol);
    }
    assert.equal(r.error, undefined);
    if (r.end) return r;
  }
  assert.fail('no ending reached within 50 steps');
}

test('a full round always reaches one of the authored endings', () => {
  for (const seed of [1, 2, 3, 4, 5, 99, 1234]) {
    const state = init({ ...freshSettings(), seed });
    const { end } = drive(state);
    assert.equal(end.winner, 'draw');              // co-op
    assert.ok(['good', 'mixed', 'bad'].includes(end.ending.tier));
    assert.equal(state.phase, 'ended');
    assert.ok(state.log.at(-1).kind === 'ending');
    assert.ok(applyMove(state, { type: 'vote', option: 0 }, 'X').error);   // round over
  }
});
