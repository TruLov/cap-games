'use strict';

const cds = require('@sap/cds');
const { expect } = cds.test;
const { describe, it } = require('node:test');
const { STRATEGIES } = require('../cards/strategies');
const { scoreRound, scoreGame } = require('../scoring');

const nigiri  = (variant, onWasabi = false) =>
  ({ type: 'nigiri', color: 'nigiri', variant, value: { egg: 1, salmon: 2, squid: 3 }[variant], onWasabi });
const maki    = (icons) => ({ type: 'maki',    color: 'maki',    icons });
const uramaki = (icons) => ({ type: 'uramaki', color: 'uramaki', icons });
const card    = (type)  => ({ type, color: type });
const onigiri = (shape) => ({ type: 'onigiri', color: 'onigiri', shape });
const fruit   = (...fruits) => ({ type: 'fruit', color: 'fruit', fruits });
const player  = (symbol, played = [], desserts = []) => ({ symbol, played, desserts });
const roundOne = (players, symbol, playerCount = players.length, state = {}) =>
  scoreRound(players, playerCount, state)[symbol];

describe('kaiten scoring', () => {

  describe('round scoring', () => {

    it('nigiri: base values + wasabi tripling', () => {
      const p = player('X', [nigiri('egg'), nigiri('salmon'), nigiri('squid', true)]);
      expect(STRATEGIES.nigiri.scoreRound(p)).to.equal(12); // 1+2+(3×3)
    });

    it('maki: most=6 second=3 (<6p), ties share', () => {
      const players = [player('X', [maki(3),maki(2)]), player('O', [maki(2)]), player('A', [maki(2)])];
      expect(roundOne(players, 'X')).to.equal(6);
      expect(roundOne(players, 'O')).to.equal(3);
      expect(roundOne(players, 'A')).to.equal(3);
    });

    it('maki: 6-8p tiers 6/4/2, zero-maki scores nothing', () => {
      const players = [player('X',[maki(3)]), player('O',[maki(2)]), player('A',[maki(1)]), player('B',[]), player('C',[]), player('D',[])];
      expect(roundOne(players, 'X', 6)).to.equal(6);
      expect(roundOne(players, 'O', 6)).to.equal(4);
      expect(roundOne(players, 'A', 6)).to.equal(2);
      expect(roundOne(players, 'B', 6)).to.equal(0);
    });

    it('temaki: most +4, fewest -4, no penalty at 2p', () => {
      const three = [player('X',[card('temaki'),card('temaki')]), player('O',[card('temaki')]), player('A',[])];
      expect(roundOne(three, 'X')).to.equal(4);
      expect(roundOne(three, 'A')).to.equal(-4);
      const two = [player('X',[card('temaki'),card('temaki')]), player('O',[])];
      expect(roundOne(two, 'O', 2)).to.equal(0);
    });

    it('uramaki: end-of-round most gets next unclaimed place', () => {
      const players = [player('X',[uramaki(5),uramaki(4)]), player('O',[uramaki(3)])];
      expect(roundOne(players, 'X', 2, { uramakiPlaceIndex: 0 })).to.equal(8);
      expect(roundOne(players, 'O', 2, { uramakiPlaceIndex: 0 })).to.equal(0);
      expect(roundOne(players, 'X', 2, { uramakiPlaceIndex: 2 })).to.equal(2);
    });

    it('tempura: sets of 2 → 5', () => {
      expect(STRATEGIES.tempura.scoreRound(player('X', [card('tempura'),card('tempura'),card('tempura')]))).to.equal(5);
    });

    it('sashimi: sets of 3 → 10', () => {
      expect(STRATEGIES.sashimi.scoreRound(player('X', Array.from({length:6}, () => card('sashimi'))))).to.equal(20);
    });

    it('dumpling: 1/3/6/10/15 curve, capped at 5', () => {
      const pts = n => STRATEGIES.dumpling.scoreRound(player('X', Array.from({length:n}, () => card('dumpling'))));
      expect([0,1,2,3,4,5,6].map(pts)).to.deep.equal([0,1,3,6,10,15,15]);
    });

    it('eel: 1=-3, 2+=7', () => {
      expect(STRATEGIES.eel.scoreRound(player('X',[card('eel')]))).to.equal(-3);
      expect(STRATEGIES.eel.scoreRound(player('X',[card('eel'),card('eel')]))).to.equal(7);
    });

    it('tofu: 1=2, 2=6, 3+=0', () => {
      const pts = n => STRATEGIES.tofu.scoreRound(player('X', Array.from({length:n}, () => card('tofu'))));
      expect([0,1,2,3].map(pts)).to.deep.equal([0,2,6,0]);
    });

    it('onigiri: unique-shape sets 1/4/9/16, multiple sets', () => {
      const s = shapes => STRATEGIES.onigiri.scoreRound(player('X', shapes.map(onigiri)));
      expect(s(['circle'])).to.equal(1);
      expect(s(['circle','triangle'])).to.equal(4);
      expect(s(['circle','triangle','square'])).to.equal(9);
      expect(s(['circle','triangle','square','rectangle'])).to.equal(16);
      expect(s(['circle','triangle','circle'])).to.equal(5); // two sets
    });

    it('edamame: 1pt per opponent with edamame, max 4', () => {
      const players = [player('X',[card('edamame'),card('edamame')]), player('O',[card('edamame')]), player('A',[])];
      expect(roundOne(players, 'X')).to.equal(2);
      expect(roundOne(players, 'O')).to.equal(1);
    });

    it('miso: 3 each (survivors)', () => {
      expect(STRATEGIES.miso.scoreRound(player('X',[card('miso'),card('miso')]))).to.equal(6);
    });

    it('soy sauce: 4pts if most distinct colors', () => {
      const players = [player('X',[card('soy_sauce'),card('tempura'),card('eel')]), player('O',[card('tofu'),card('tofu')])];
      const ctx = { players, playerCount: 2, state: {} };
      expect(STRATEGIES.soy_sauce.scoreRound(players[0], ctx)).to.equal(4);
      expect(STRATEGIES.soy_sauce.scoreRound(players[1], ctx)).to.equal(0);
    });

    it('tea: 1pt per card in largest single-color group, per tea', () => {
      const p = player('X',[card('tea'),card('tempura'),card('tempura'),card('tempura')]);
      expect(STRATEGIES.tea.scoreRound(p, { players:[p], playerCount:1, state:{} })).to.equal(3);
    });

    it('takeout box: flipped cards worth 2 each, lose identity', () => {
      const flipped = { ...card('eel'), flipped: true };
      const p = player('X',[flipped, flipped, card('eel')]);
      expect(roundOne([p], 'X', 1)).to.equal(1); // 2×2 + single eel(-3) = 1
    });

  });

  describe('desserts', () => {

    it('pudding: most +6, fewest -6, no penalty at 2p', () => {
      const players = [player('X',[],[card('pudding'),card('pudding')]), player('O',[],[card('pudding')]), player('A',[],[])];
      const g = scoreGame(players, 3, 'pudding');
      expect(g.X).to.equal(6);
      expect(g.A).to.equal(-6);
      const two = scoreGame([player('X',[],[card('pudding'),card('pudding')]), player('O',[],[])], 2, 'pudding');
      expect(two.O).to.equal(0);
    });

    it('green tea ice cream: sets of 4 → 12', () => {
      const p = player('X',[],Array.from({length:9}, () => card('green_tea_ice_cream')));
      expect(STRATEGIES.green_tea_ice_cream.scoreGame(p)).to.equal(24);
    });

    it('fruit: per-type icon table incl 0-icon penalty', () => {
      const p = player('X',[],[fruit('watermelon','watermelon'),fruit('watermelon','watermelon'),fruit('watermelon','orange')]);
      expect(STRATEGIES.fruit.scoreGame(p)).to.equal(8);
      expect(STRATEGIES.fruit.scoreGame(player('X',[],[]))).to.equal(-6);
    });

  });

});
