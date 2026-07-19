import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import game from '../index.js';
import { treeBuilder, chronicler } from '../lib/ai-static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scenario = JSON.parse(readFileSync(join(__dirname, '../db/data/nebelmine.json'), 'utf8'));

const party = [
  { symbol: 'X', user: 'alice', isHost: true },
  { symbol: 'O', user: 'bob' },
];
const settings = () => treeBuilder({ scenario, party, seed: 11 });

test('game exposes the platform contract', () => {
  assert.equal(game.meta.name, 'Kaffee-Kwest');
  assert.equal(game.meta.minPlayers, 2);
  for (const k of ['init', 'applyMove', 'score', 'publicState', 'privateState'])
    assert.equal(typeof game[k], 'function');
});

test('publicState never leaks the tree, the seed or vote choices', () => {
  const state = game.init(settings());
  game.applyMove(state, { type: 'vote', option: 1 }, 'X');
  const pub = game.publicState(state);
  assert.equal(pub.tree, undefined);
  assert.equal(pub.seed, undefined);
  assert.equal(pub.rngN, undefined);
  assert.deepEqual(pub.votes, { X: true });                    // who voted, not what
  assert.deepEqual(pub.node.options, scenario.tree.nodes.eingang.options.map(o => o.label));
  assert.equal(JSON.stringify(pub).includes('"next"'), false); // no branch targets
  assert.equal(pub.casting.X.hook, undefined);                 // hooks are private
});

test('privateState adds the own role hook on top of the public view', () => {
  const state = game.init(settings());
  const priv = game.privateState(state, 'X');
  assert.equal(priv.me.role, state.casting.X.role);
  assert.equal(priv.me.hook, state.casting.X.hook);
  assert.equal(priv.tree, undefined);
  assert.equal(game.privateState(state, 'spectator').me, null);
});

test('score: co-op draw for everyone, points by ending tier', () => {
  const players = [...party.map(p => ({ ...p })), { symbol: 'spectator', user: 'sam' }];
  for (const [tier, points] of [['good', 3], ['mixed', 2], ['bad', 1]]) {
    const scores = game.score({ winner: 'draw', ending: { tier } }, players);
    assert.equal(scores.length, 2);                            // spectator excluded
    assert.ok(scores.every(s => s.result === 'draw' && s.points === points));
  }
});

test('chronicler suggests at most 2 scenario-neutral entries from the log', () => {
  const finalState = {
    party,
    casting: { X: { role: 'Schmied:in mit Vorschlaghammer' }, O: { role: 'Unterhändler:in des Dorfes' } },
    log: [
      { kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true },
      { kind: 'moment', by: 'X', text: 'Ich biete dir meinen Hammer!' },
      { kind: 'roll', by: 'X', die: 1, bonus: 2, total: 3, target: 12, success: false },
      { kind: 'roll', by: 'O', die: 10, bonus: 0, total: 10, target: 12, success: false },
    ],
  };
  const forAlice = chronicler(finalState, 'alice');
  assert.equal(forAlice.length, 2);                            // capped at 2
  assert.ok(forAlice[0].includes('vom Glück geküsst'));
  assert.deepEqual(chronicler(finalState, 'bob'), []);         // nothing notable
  assert.deepEqual(chronicler(finalState, 'nobody'), []);      // not in party
});
