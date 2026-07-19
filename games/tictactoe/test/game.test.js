

import cds from '@sap/cds';
const { expect } = cds.test;
import { describe, it } from 'node:test';
import game from '../index.js';

// play a sequence of cells using state.turn; return last result
const play = (cells, first = 'X') => {
  let s = game.init({ firstPlayer: first }), r;
  for (const cell of cells) { r = game.applyMove(s, { cell }, s.turn); if (r.state) s = r.state; }
  return r;
};

describe('tictactoe', () => {

  it('interface + init contract', () => {
    expect(game.meta.minPlayers).to.equal(2);
    expect(game.meta.maxPlayers).to.equal(2);
    const s = game.init({ firstPlayer: 'O' });
    expect(s.board).to.have.length(9);
    expect(s.turn).to.equal('O');
  });

  it('applyMove rejects illegal moves', () => {
    const s = game.init({ firstPlayer: 'X' });
    expect(game.applyMove(s, { cell: 0 }, 'O').error).to.equal('not your turn');
    expect(game.applyMove(s, { cell: 9 }, 'X').error).to.be.ok;
    const { state } = game.applyMove(s, { cell: 4 }, 'X');
    expect(game.applyMove(state, { cell: 4 }, 'O').error).to.be.ok;
  });

  it('win → end.winner is the symbol', () => {
    expect(play([0, 3, 1, 4, 2]).end?.winner).to.equal('X'); // top row
  });

  it('draw → end.winner is "draw"', () => {
    expect(play([0, 1, 2, 3, 5, 4, 6, 8, 7]).end?.winner).to.equal('draw');
  });

  it('no end mid-game', () => {
    expect(play([0]).end).to.equal(null);
  });

});
