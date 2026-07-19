

import cds from '@sap/cds';
const { expect } = cds.test;
import { describe, it } from 'node:test';
import game from '../index.js';

describe('kaiten game', () => {

  it('exposes required platform interface', () => {
    expect(typeof game.meta).to.equal('object');
    expect(typeof game.init).to.equal('function');
    expect(typeof game.applyMove).to.equal('function');
    expect(game.meta.minPlayers).to.equal(2);
    expect(game.meta.maxPlayers).to.be.ok;
    expect(Array.isArray(game.settingsSchema.preset.values)).to.be.true;
  });

  it('init + applyMove round-trip', () => {
    const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
    expect(s.hands.X).to.have.length(10);
    expect(game.applyMove(s, { pick: 0 }, 'X').end).to.equal(null);
  });

  it('score: single winner → win/loss with points', () => {
    const end = { winner: 'X', ranking: [
      { symbol: 'X', score: 40, desserts: 3 },
      { symbol: 'O', score: 25, desserts: 2 },
    ]};
    const scores = game.score(end, [{ user: 'alice', symbol: 'X' }, { user: 'bob', symbol: 'O' }]);
    expect(scores).to.deep.equal([
      { user: 'alice', result: 'win',  points: 40 },
      { user: 'bob',   result: 'loss', points: 25 },
    ]);
  });

  it('score: shared top → draw', () => {
    const end = { winner: 'draw', ranking: [
      { symbol: 'X', score: 30, desserts: 2 },
      { symbol: 'O', score: 30, desserts: 2 },
    ]};
    const scores = game.score(end, [{ user: 'a', symbol: 'X' }, { user: 'b', symbol: 'O' }]);
    expect(scores.every(s => s.result === 'draw')).to.be.true;
  });

  it('score: ignores spectators', () => {
    const end = { winner: 'X', ranking: [{ symbol: 'X', score: 10, desserts: 1 }] };
    const scores = game.score(end, [{ user: 'a', symbol: 'X' }, { user: 'c', symbol: 'spectator' }]);
    expect(scores).to.have.length(1);
    expect(scores[0].user).to.equal('a');
  });

  it('publicState hides hands, drawPile, dessertPool, pending', () => {
    const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
    const pub = game.publicState(s);
    expect(pub.hands).to.equal(undefined);
    expect(pub.drawPile).to.equal(undefined);
    expect(pub.dessertPool).to.equal(undefined);
    expect(pub.pending).to.equal(undefined);
    expect(pub.handCounts.X).to.equal(10);
    expect(pub.selected.X).to.equal(false);
  });

  it('publicState reveals selection flag but not what was picked', () => {
    const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
    game.applyMove(s, { pick: 3 }, 'X');
    const pub = game.publicState(s);
    expect(pub.selected.X).to.equal(true);
    expect(pub.selected.O).to.equal(false);
    expect(JSON.stringify(pub)).to.not.include('"pick"');
  });

  it('privateState exposes only the requesting player hand', () => {
    const s = game.init({ players: ['X', 'O'], preset: 'classic', seed: 7 });
    const priv = game.privateState(s, 'X');
    expect(priv.myHand).to.have.length(10);
    expect(priv.hands).to.equal(undefined);
  });

});
