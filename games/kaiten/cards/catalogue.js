/**
 * Kaiten — Card catalogue (static data for the full 181-card pool).
 *
 * Pure data + pool builders. No CAP imports, no game state.
 *
 * A card *instance* is a small immutable object:
 *   { type, color, ...variantFields }
 *   - `type`  : card-type id (see CARD_TYPES)
 *   - `color` : background color used by Soy Sauce / Tea scoring.
 *               Cards of the same type share a color, so we use the type id
 *               (Nigiri variants therefore all share the 'nigiri' color).
 *
 * Pool totals (sum = 181):
 *   rolls/nigiri : 12 each × 4 = 48
 *   appetizers   :  8 each × 8 = 64
 *   specials     :  3 each × 8 = 24
 *   desserts     : 15 each × 3 = 45
 */



const CATEGORY = Object.freeze({
  NIGIRI:    'nigiri',
  ROLL:      'roll',
  APPETIZER: 'appetizer',
  SPECIAL:   'special',
  DESSERT:   'dessert',
});

/**
 * Card-type metadata. `count` is the number of cards of this type in the
 * full physical pool.
 */
const CARD_TYPES = Object.freeze({
  // --- Nigiri (always in every menu) ---
  nigiri:            { id: 'nigiri',            name: 'Nigiri',              category: CATEGORY.NIGIRI,    count: 12 },

  // --- Rolls (pick 1) ---
  maki:              { id: 'maki',              name: 'Maki Roll',           category: CATEGORY.ROLL,      count: 12 },
  temaki:            { id: 'temaki',            name: 'Temaki',              category: CATEGORY.ROLL,      count: 12 },
  uramaki:           { id: 'uramaki',           name: 'Uramaki',             category: CATEGORY.ROLL,      count: 12 },

  // --- Appetizers (pick 3) ---
  tempura:           { id: 'tempura',           name: 'Tempura',             category: CATEGORY.APPETIZER, count: 8 },
  sashimi:           { id: 'sashimi',           name: 'Sashimi',             category: CATEGORY.APPETIZER, count: 8 },
  dumpling:          { id: 'dumpling',          name: 'Dumpling',            category: CATEGORY.APPETIZER, count: 8 },
  eel:               { id: 'eel',               name: 'Eel',                 category: CATEGORY.APPETIZER, count: 8 },
  tofu:              { id: 'tofu',              name: 'Tofu',                category: CATEGORY.APPETIZER, count: 8 },
  onigiri:           { id: 'onigiri',           name: 'Onigiri',             category: CATEGORY.APPETIZER, count: 8 },
  edamame:           { id: 'edamame',           name: 'Edamame',             category: CATEGORY.APPETIZER, count: 8 },
  miso:              { id: 'miso',              name: 'Miso Soup',           category: CATEGORY.APPETIZER, count: 8 },

  // --- Specials (pick 2) ---
  chopsticks:        { id: 'chopsticks',        name: 'Chopsticks',          category: CATEGORY.SPECIAL,   count: 3, bonusAction: true },
  spoon:             { id: 'spoon',             name: 'Spoon',               category: CATEGORY.SPECIAL,   count: 3, bonusAction: true },
  wasabi:            { id: 'wasabi',            name: 'Wasabi',              category: CATEGORY.SPECIAL,   count: 3 },
  soy_sauce:         { id: 'soy_sauce',         name: 'Soy Sauce',           category: CATEGORY.SPECIAL,   count: 3 },
  tea:               { id: 'tea',               name: 'Tea',                 category: CATEGORY.SPECIAL,   count: 3 },
  menu:              { id: 'menu',              name: 'Menu',                category: CATEGORY.SPECIAL,   count: 3, bonusAction: true },
  special_order:     { id: 'special_order',     name: 'Special Order',       category: CATEGORY.SPECIAL,   count: 3, bonusAction: true },
  takeout_box:       { id: 'takeout_box',       name: 'Takeout Box',         category: CATEGORY.SPECIAL,   count: 3, bonusAction: true },

  // --- Desserts (pick 1) ---
  pudding:           { id: 'pudding',           name: 'Pudding',             category: CATEGORY.DESSERT,   count: 15 },
  green_tea_ice_cream:{ id: 'green_tea_ice_cream', name: 'Green Tea Ice Cream', category: CATEGORY.DESSERT, count: 15 },
  fruit:             { id: 'fruit',             name: 'Fruit',               category: CATEGORY.DESSERT,   count: 15 },
});

// Menu-selection groupings.
const ROLLS      = ['maki', 'temaki', 'uramaki'];
const APPETIZERS = ['tempura', 'sashimi', 'dumpling', 'eel', 'tofu', 'onigiri', 'edamame', 'miso'];
const SPECIALS   = ['chopsticks', 'spoon', 'wasabi', 'soy_sauce', 'tea', 'menu', 'special_order', 'takeout_box'];
const DESSERTS   = ['pudding', 'green_tea_ice_cream', 'fruit'];

// --- Variant distributions (faithful-enough to the physical deck) ---

// Nigiri: Egg 4, Salmon 5, Squid 3 = 12
const NIGIRI_VALUES = Object.freeze({ egg: 1, salmon: 2, squid: 3 });
const NIGIRI_DIST   = Object.freeze({ egg: 4, salmon: 5, squid: 3 });

// Maki icons: 4×1, 5×2, 3×3 = 12 cards
const MAKI_DIST    = Object.freeze({ 1: 4, 2: 5, 3: 3 });

// Uramaki icons: 4×3, 4×4, 4×5 = 12 cards
const URAMAKI_DIST = Object.freeze({ 3: 4, 4: 4, 5: 4 });

// Onigiri shapes: 2 of each of 4 shapes = 8
const ONIGIRI_SHAPES = Object.freeze(['circle', 'triangle', 'square', 'rectangle']);

// Fruit: 15 cards, each shows 2 fruit icons (watermelon/orange/pineapple).
// Distribution chosen to total 30 icons spread across the three types.
const FRUIT_TYPES = Object.freeze(['watermelon', 'orange', 'pineapple']);
const FRUIT_CARDS = Object.freeze([
  ['watermelon', 'watermelon'],
  ['watermelon', 'orange'],
  ['watermelon', 'pineapple'],
  ['orange', 'orange'],
  ['orange', 'watermelon'],
  ['orange', 'pineapple'],
  ['pineapple', 'pineapple'],
  ['pineapple', 'watermelon'],
  ['pineapple', 'orange'],
  ['watermelon', 'watermelon'],
  ['orange', 'orange'],
  ['pineapple', 'pineapple'],
  ['watermelon', 'orange'],
  ['orange', 'pineapple'],
  ['pineapple', 'watermelon'],
]);

/** Repeat helper — build an array of `n` cards produced by `factory`. */
function repeat(n, factory) {
  return Array.from({ length: n }, (_, i) => factory(i));
}

/**
 * Build all card instances for a single card type.
 * @param {string} type card-type id
 * @returns {Array<object>} freshly built card instances
 */
function cardsOfType(type) {
  const meta = CARD_TYPES[type];
  if (!meta) throw new Error(`unknown card type: ${type}`);

  switch (type) {
    case 'nigiri':
      return Object.entries(NIGIRI_DIST).flatMap(([variant, n]) =>
        repeat(n, () => ({ type, color: type, variant, value: NIGIRI_VALUES[variant] })));

    case 'maki':
      return Object.entries(MAKI_DIST).flatMap(([icons, n]) =>
        repeat(n, () => ({ type, color: type, icons: Number(icons) })));

    case 'uramaki':
      return Object.entries(URAMAKI_DIST).flatMap(([icons, n]) =>
        repeat(n, () => ({ type, color: type, icons: Number(icons) })));

    case 'onigiri':
      return ONIGIRI_SHAPES.flatMap(shape =>
        repeat(2, () => ({ type, color: type, shape })));

    case 'fruit':
      return FRUIT_CARDS.map(fruits => ({ type, color: type, fruits: [...fruits] }));

    default:
      // Plain card: temaki, all appetizers except onigiri, all specials, other desserts.
      return repeat(meta.count, () => ({ type, color: type }));
  }
}

export {
  CATEGORY,
  CARD_TYPES,
  ROLLS,
  APPETIZERS,
  SPECIALS,
  DESSERTS,
  NIGIRI_VALUES,
  ONIGIRI_SHAPES,
  FRUIT_TYPES,
  cardsOfType,
};
