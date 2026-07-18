'use strict';

const cds = require('@sap/cds');
const { expect } = cds.test;
const { describe, it } = require('node:test');
const flow = require('../flow');
const game = require('../game');

const card   = (t) => ({ type: t, color: t });
const filler = () => card('maki');

describe('kaiten bonus actions', () => {

  describe('spoon', () => {

    it('pulls the named card from the first left-neighbour who has it', () => {
      const s = flow.init({ players: ['X','O','A'], preset: 'master_menu', seed: 1 });
      s.played.X = [card('spoon')];
      s.hands.X = [card('sashimi'), filler()];
      s.hands.O = [card('sashimi'), card('tofu')];
      s.hands.A = [filler(), filler()];
      s.pending = {};
      flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'tofu' }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
      flow.applyMove(s, { pick: 0 }, 'A');
      expect(s.played.X.some(c => c.type === 'sashimi')).to.be.true;
      expect(s.played.X.some(c => c.type === 'tofu')).to.be.true;
      expect(s.played.X.some(c => c.type === 'spoon')).to.be.false;
      expect(s.played.O.some(c => c.type === 'spoon')).to.be.true;
      expect(s.hands.O.some(c => c.type === 'tofu')).to.be.false;
    });

    it('discards spoon when no one holds the named card', () => {
      const s = flow.init({ players: ['X','O','A'], preset: 'master_menu', seed: 2 });
      s.played.X = [card('spoon')];
      s.hands.X = [card('sashimi'), filler()];
      s.hands.O = [filler(), filler()];
      s.hands.A = [filler(), filler()];
      s.pending = {};
      flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'eel' }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
      flow.applyMove(s, { pick: 0 }, 'A');
      expect(s.played.X.some(c => c.type === 'spoon')).to.be.false;
      expect(s.played.O.some(c => c.type === 'spoon')).to.be.false;
      expect(s.played.A.some(c => c.type === 'spoon')).to.be.false;
    });

    it('requires an unused spoon in front of the player', () => {
      const s = flow.init({ players: ['X','O','A'], preset: 'master_menu', seed: 3 });
      s.played.X = [];
      s.pending = {};
      expect(flow.applyMove(s, { pick: 0, bonus: 'spoon', cardType: 'tofu' }, 'X').error).to.match(/no spoon/i);
    });

  });

  describe('menu', () => {

    it('offers 4 cards, plays the chosen one, returns the rest', () => {
      const s = flow.init({ players: ['X','O'], preset: 'party_sampler', seed: 4 });
      s.played.X = [];
      s.hands.X = [card('menu'), filler()];
      s.hands.O = [filler(), filler()];
      s.pending = {};
      s.drawPile = [card('tempura'),card('dumpling'),card('tofu'),card('tempura'),card('eel')];
      const drawBefore = s.drawPile.length;

      expect(flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X').end).to.equal(null);
      expect(s.menuOffer.X).to.have.length(4);
      expect(s.drawPile).to.have.length(drawBefore - 4);

      const chosenType = s.menuOffer.X[2].type;
      flow.applyMove(s, { menuChoice: 2 }, 'X');
      flow.applyMove(s, { pick: 0 }, 'O');
      expect(s.played.X.some(c => c.type === chosenType)).to.be.true;
      expect(s.played.X.some(c => c.type === 'menu')).to.be.false;
      expect(s.drawPile).to.have.length(drawBefore - 1);
    });

    it('cannot choose another Menu card', () => {
      const s = flow.init({ players: ['X','O'], preset: 'party_sampler', seed: 5 });
      s.played.X = [];
      s.hands.X = [card('menu'), filler()];
      s.hands.O = [filler(), filler()];
      s.pending = {};
      s.drawPile = [card('menu'),card('tofu'),card('eel'),card('dumpling')];
      flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X');
      expect(flow.applyMove(s, { menuChoice: 0 }, 'X').error).to.match(/another Menu/i);
    });

    it('blocks normal move while a Menu selection is pending', () => {
      const s = flow.init({ players: ['X','O'], preset: 'party_sampler', seed: 6 });
      s.played.X = [];
      s.hands.X = [card('menu'), filler()];
      s.hands.O = [filler(), filler()];
      s.pending = {};
      s.drawPile = [card('tofu'),card('eel'),card('dumpling'),card('tempura')];
      flow.applyMove(s, { pick: 0, bonus: 'menu' }, 'X');
      expect(flow.applyMove(s, { pick: 0 }, 'X').error).to.match(/resolve your Menu/i);
    });

  });

  describe('projection', () => {

    it('menu offer is private: hidden publicly, visible only to owner', () => {
      const s = flow.init({ players: ['X','O'], preset: 'party_sampler', seed: 7 });
      s.menuOffer = { X: [card('tofu'), card('eel')] };
      const pub = game.publicState(s);
      expect(pub.menuOffer).to.equal(undefined);
      expect(game.privateState(s, 'X').menuOffer).to.deep.equal(s.menuOffer.X);
      expect(game.privateState(s, 'O').menuOffer).to.equal(undefined);
    });

  });

});
