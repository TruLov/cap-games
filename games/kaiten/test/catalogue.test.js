'use strict';

const cds = require('@sap/cds');
const { expect } = cds.test;
const { describe, it } = require('node:test');
const { CARD_TYPES, cardsOfType, ONIGIRI_SHAPES } = require('../cards/catalogue');

describe('kaiten catalogue', () => {

  it('full pool totals 181 cards across all types', () => {
    const total = Object.keys(CARD_TYPES).reduce((sum, t) => sum + cardsOfType(t).length, 0);
    expect(total).to.equal(181);
  });

  it('each type produces exactly its declared count', () => {
    for (const [type, meta] of Object.entries(CARD_TYPES))
      expect(cardsOfType(type)).to.have.length(meta.count);
  });

  it('nigiri variants carry correct point values', () => {
    const byVariant = Object.groupBy(cardsOfType('nigiri'), c => c.variant);
    expect(byVariant.egg).to.have.length(4);
    expect(byVariant.salmon).to.have.length(5);
    expect(byVariant.squid).to.have.length(3);
    expect(byVariant.egg[0].value).to.equal(1);
    expect(byVariant.salmon[0].value).to.equal(2);
    expect(byVariant.squid[0].value).to.equal(3);
  });

  it('maki shows 1/2/3 icons, uramaki shows 3/4/5 icons', () => {
    expect(cardsOfType('maki').every(c => [1,2,3].includes(c.icons))).to.be.true;
    expect(cardsOfType('maki')).to.have.length(12);
    expect(cardsOfType('uramaki').every(c => [3,4,5].includes(c.icons))).to.be.true;
  });

  it('onigiri has 2 of each of 4 shapes', () => {
    const byShape = Object.groupBy(cardsOfType('onigiri'), c => c.shape);
    for (const shape of ONIGIRI_SHAPES) expect(byShape[shape]).to.have.length(2);
  });

  it('fruit cards each show 2 icons', () => {
    const fruit = cardsOfType('fruit');
    expect(fruit).to.have.length(15);
    expect(fruit.every(c => c.fruits.length === 2)).to.be.true;
  });

  it('every card carries a color equal to its type', () => {
    for (const type of Object.keys(CARD_TYPES))
      expect(cardsOfType(type).every(c => c.color === type)).to.be.true;
  });

  it('unknown card type throws', () => {
    expect(() => cardsOfType('does_not_exist')).to.throw();
  });

});
