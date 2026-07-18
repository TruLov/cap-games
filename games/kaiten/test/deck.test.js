'use strict';

const cds = require('@sap/cds');
const { expect } = cds.test;
const { describe, it } = require('node:test');
const {
  MENUS, dealCount, dessertCount, resolveMenu, validateMenu,
  baseDeck, dessertPool, makeRng, shuffle,
} = require('../deck');

describe('kaiten deck', () => {

  it('deal counts by player count', () => {
    expect(dealCount(2)).to.equal(10);
    expect(dealCount(3)).to.equal(10);
    expect(dealCount(4)).to.equal(9);
    expect(dealCount(5)).to.equal(9);
    expect(dealCount(6)).to.equal(8);
    expect(dealCount(7)).to.equal(8);
    expect(dealCount(8)).to.equal(7);
  });

  it('dessert counts per round by group', () => {
    expect([1,2,3].map(r => dessertCount(4, r))).to.deep.equal([5, 3, 2]);
    expect([1,2,3].map(r => dessertCount(6, r))).to.deep.equal([7, 5, 3]);
  });

  it('all 8 predefined menus resolve and validate', () => {
    for (const preset of Object.keys(MENUS)) {
      const menu = resolveMenu({ preset }, 3);
      expect(menu.appetizers).to.have.length(3);
      expect(menu.specials).to.have.length(2);
    }
  });

  describe('menu restrictions', () => {

    it('Spoon/Edamame banned at 2 players', () => {
      expect(() => validateMenu({ roll: 'maki', appetizers: ['edamame','tempura','tofu'], specials: ['wasabi','tea'], dessert: 'pudding' }, 2)).to.throw();
      expect(() => validateMenu({ roll: 'maki', appetizers: ['tempura','sashimi','tofu'], specials: ['spoon','tea'],  dessert: 'pudding' }, 2)).to.throw();
    });

    it('Menu/Special Order banned at 7–8 players', () => {
      expect(() => validateMenu({ roll: 'maki', appetizers: ['tempura','sashimi','tofu'], specials: ['menu','tea'],          dessert: 'pudding' }, 7)).to.throw();
      expect(() => validateMenu({ roll: 'maki', appetizers: ['tempura','sashimi','tofu'], specials: ['special_order','tea'], dessert: 'pudding' }, 8)).to.throw();
    });

    it('composition must be exactly 1/3/2/1', () => {
      expect(() => validateMenu({ roll: 'maki',     appetizers: ['tempura','sashimi'],       specials: ['wasabi','tea'], dessert: 'pudding' }, 3)).to.throw();
      expect(() => validateMenu({ roll: 'maki',     appetizers: ['tempura','sashimi','tofu'], specials: ['wasabi'],      dessert: 'pudding' }, 3)).to.throw();
      expect(() => validateMenu({ roll: 'bad_roll', appetizers: ['tempura','sashimi','tofu'], specials: ['wasabi','tea'], dessert: 'pudding' }, 3)).to.throw();
    });

  });

  it('base deck excludes desserts and has 54 cards', () => {
    const menu = resolveMenu({ preset: 'classic' }, 3);
    const deck = baseDeck(menu);
    expect(deck).to.have.length(54);
    expect(deck.every(c => c.type !== menu.dessert)).to.be.true;
  });

  it('dessert pool is 15 pudding cards', () => {
    const menu = resolveMenu({ preset: 'classic' }, 3);
    const pool = dessertPool(menu);
    expect(pool).to.have.length(15);
    expect(pool.every(c => c.type === 'pudding')).to.be.true;
  });

  it('seeded shuffle is deterministic and non-mutating', () => {
    const src = Array.from({ length: 20 }, (_, i) => i);
    const a = shuffle(src, makeRng(42));
    const b = shuffle(src, makeRng(42));
    expect(a).to.deep.equal(b);
    expect(src).to.deep.equal(Array.from({ length: 20 }, (_, i) => i));
    expect(a).to.not.deep.equal(src);
    expect([...a].sort((x, y) => x - y)).to.deep.equal(src);
  });

});
