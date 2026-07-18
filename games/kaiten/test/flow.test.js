'use strict';

const cds = require('@sap/cds');
const { expect } = cds.test;
const { describe, it } = require('node:test');
const flow = require('../flow');

const START = (players, extra = {}) =>
  flow.init({ players, preset: 'classic', seed: 12345, ...extra });

describe('kaiten flow', () => {

  it('init deals correct hand sizes and sets up state', () => {
    const s = START(['X', 'O']);
    expect(s.phase).to.equal('playing');
    expect(s.turn).to.equal('all');
    expect(s.round).to.equal(1);
    expect(s.hands.X).to.have.length(10);
    expect(s.hands.O).to.have.length(10);
    expect(s.drawPile).to.have.length(59 - 20);
  });

  it('init rejects fewer than 2 players', () => {
    expect(() => flow.init({ players: ['X'], preset: 'classic' })).to.throw();
  });

  it('applyMove buffers until all players have selected', () => {
    const s = START(['X', 'O']);
    expect(flow.applyMove(s, { pick: 0 }, 'X').end).to.equal(null);
    expect(s.pending.X.pick).to.equal(0);
    expect(s.pending.O).to.equal(undefined);
    expect(flow.applyMove(s, { pick: 1 }, 'X').error).to.match(/already selected/);
  });

  it('turn resolves and rotates hands when all selected', () => {
    const s = START(['X', 'O']);
    const xBefore = [...s.hands.X];
    const oBefore = [...s.hands.O];
    flow.applyMove(s, { pick: 0 }, 'X');
    flow.applyMove(s, { pick: 0 }, 'O');
    expect(s.hands.X).to.have.length(9);
    expect(s.hands.X).to.deep.equal(oBefore.slice(1));
    expect(s.hands.O).to.deep.equal(xBefore.slice(1));
    expect(s.played.X).to.have.length(1);
    expect(Object.keys(s.pending)).to.have.length(0);
  });

  it('nigiri auto-places on an unoccupied wasabi', () => {
    const s = flow.init({ players: ['X', 'O'], preset: 'classic', seed: 1 });
    s.hands.X = [{ type: 'wasabi', color: 'wasabi' }, { type: 'nigiri', color: 'nigiri', variant: 'squid', value: 3 }];
    s.hands.O = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }];
    flow.applyMove(s, { pick: 0 }, 'X');
    flow.applyMove(s, { pick: 0 }, 'O');
    s.hands.X = [{ type: 'nigiri', color: 'nigiri', variant: 'squid', value: 3 }, { type: 'maki', color: 'maki', icons: 1 }];
    s.hands.O = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }];
    flow.applyMove(s, { pick: 0 }, 'X');
    flow.applyMove(s, { pick: 0 }, 'O');
    expect(s.played.X.find(c => c.type === 'nigiri').onWasabi).to.equal(true);
    expect(s.played.X.find(c => c.type === 'wasabi').occupied).to.equal(true);
  });

  it('full round advances to round 2 and re-deals', () => {
    const s = START(['X', 'O']);
    for (let i = 0; i < 10; i++) { flow.applyMove(s, { pick: 0 }, 'X'); flow.applyMove(s, { pick: 0 }, 'O'); }
    expect(s.round).to.equal(2);
    expect(s.hands.X).to.have.length(10);
    expect(s.roundScores.X[0]).to.not.equal(null);
  });

  it('full 3-round game ends with a ranking', () => {
    const s = START(['X', 'O']);
    let end = null;
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 10; i++) { flow.applyMove(s, { pick: 0 }, 'X'); const res = flow.applyMove(s, { pick: 0 }, 'O'); if (res.end) end = res.end; }
    expect(end).to.be.ok;
    expect(s.phase).to.equal('gameOver');
    expect(end.ranking).to.have.length(2);
    expect(['X','O','draw']).to.include(end.winner);
    expect(end.ranking[0].score >= end.ranking[1].score).to.be.true;
  });

  it('rejects moves after game over', () => {
    const s = START(['X', 'O']);
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 10; i++) { flow.applyMove(s, { pick: 0 }, 'X'); flow.applyMove(s, { pick: 0 }, 'O'); }
    expect(flow.applyMove(s, { pick: 0 }, 'X').error).to.match(/not in progress/);
  });

  it('state is JSON-serializable after a turn', () => {
    const s = START(['X', 'O', 'A']);
    flow.applyMove(s, { pick: 0 }, 'X');
    flow.applyMove(s, { pick: 0 }, 'O');
    flow.applyMove(s, { pick: 0 }, 'A');
    expect(() => JSON.stringify(s)).to.not.throw();
  });

  describe('chopsticks', () => {

    it('play chopsticks then activate to play two cards', () => {
      const s = flow.init({ players: ['X', 'O'], preset: 'classic', seed: 1 });
      s.hands.X = [{ type: 'chopsticks', color: 'chopsticks' }, { type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 2 }];
      s.hands.O = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 1 }];
      flow.applyMove(s, { pick: 0 }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
      expect(s.played.X[0].type).to.equal('chopsticks');

      flow.applyMove(s, { pick: 0, pick2: 1 }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
      expect(s.played.X.filter(c => c.type === 'maki')).to.have.length(2);
      expect(s.played.X.some(c => c.type === 'chopsticks')).to.be.false;
      expect(s.hands.O.some(c => c.type === 'chopsticks')).to.be.true;
    });

    it('cannot use pick2 without a chopsticks in the tableau', () => {
      const s = flow.init({ players: ['X', 'O'], preset: 'classic', seed: 1 });
      s.hands.X = [{ type: 'maki', color: 'maki', icons: 1 }, { type: 'maki', color: 'maki', icons: 2 }];
      expect(flow.applyMove(s, { pick: 0, pick2: 1 }, 'X').error).to.match(/no chopsticks/);
    });

  });

});
