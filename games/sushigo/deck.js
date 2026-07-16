/**
 * Sushi Go Party! — Deck assembly, menus, and deterministic shuffling.
 *
 * Pure logic. No CAP imports, no game state.
 */

'use strict';

const { CARD_TYPES, ROLLS, APPETIZERS, SPECIALS, DESSERTS, cardsOfType } = require('./cards/catalogue');

// --- Predefined menus (from specification.md) ---
const MENUS = Object.freeze({
  'my_first_meal': {
    name: 'My First Meal',
    roll: 'maki', appetizers: ['tempura', 'sashimi', 'miso'],
    specials: ['wasabi', 'tea'], dessert: 'green_tea_ice_cream',
  },
  'sushi_go': {
    name: 'Sushi Go!',
    roll: 'maki', appetizers: ['tempura', 'sashimi', 'dumpling'],
    specials: ['chopsticks', 'wasabi'], dessert: 'pudding',
  },
  'party_sampler': {
    name: 'Party Sampler',
    roll: 'temaki', appetizers: ['tempura', 'dumpling', 'tofu'],
    specials: ['wasabi', 'menu'], dessert: 'green_tea_ice_cream',
  },
  'master_menu': {
    name: 'Master Menu',
    roll: 'temaki', appetizers: ['onigiri', 'tofu', 'sashimi'],
    specials: ['spoon', 'takeout_box'], dessert: 'fruit',
  },
  'points_platter': {
    name: 'Points Platter',
    roll: 'uramaki', appetizers: ['onigiri', 'dumpling', 'edamame'],
    specials: ['special_order', 'tea'], dessert: 'green_tea_ice_cream',
  },
  'cutthroat_combo': {
    name: 'Cutthroat Combo',
    roll: 'temaki', appetizers: ['eel', 'tofu', 'miso'],
    specials: ['spoon', 'soy_sauce'], dessert: 'pudding',
  },
  'big_banquet': {
    name: 'Big Banquet',
    roll: 'maki', appetizers: ['tempura', 'dumpling', 'eel'],
    specials: ['spoon', 'chopsticks'], dessert: 'green_tea_ice_cream',
  },
  'dinner_for_two': {
    name: 'Dinner for Two',
    roll: 'uramaki', appetizers: ['onigiri', 'tofu', 'miso'],
    specials: ['menu', 'special_order'], dessert: 'fruit',
  },
});

// --- Player-count-based rules ---

/** Hand size dealt to each player at the start of a round. */
function dealCount(playerCount) {
  if (playerCount <= 3) return 10;
  if (playerCount <= 5) return 9;
  if (playerCount <= 7) return 8;
  return 7; // 8 players
}

/** Number of dessert cards shuffled into the deck before a given round (1..3). */
function dessertCount(playerCount, round) {
  const small = playerCount <= 5;
  const table = small ? { 1: 5, 2: 3, 3: 2 } : { 1: 7, 2: 5, 3: 3 };
  return table[round] ?? 0;
}

// --- Menu resolution & validation ---

/**
 * Cards restricted by player count.
 * Menu & Special Order: not usable at 7–8 players.
 * Spoon & Edamame: not usable at 2 players.
 */
function restrictedTypes(playerCount) {
  const restricted = new Set();
  if (playerCount >= 7) { restricted.add('menu'); restricted.add('special_order'); }
  if (playerCount <= 2) { restricted.add('spoon'); restricted.add('edamame'); }
  return restricted;
}

/**
 * Resolve a menu configuration into a concrete menu object.
 * @param {object} config either { preset: 'sushi_go' } or a full custom menu
 *        { roll, appetizers: [3], specials: [2], dessert }
 * @param {number} playerCount used for restriction validation
 * @returns {{ roll, appetizers, specials, dessert, name? }}
 * @throws Error on invalid composition or restricted cards
 */
function resolveMenu(config = {}, playerCount = 2) {
  let menu;
  if (config.preset) {
    const preset = MENUS[config.preset];
    if (!preset) throw new Error(`unknown menu preset: ${config.preset}`);
    menu = { name: preset.name, roll: preset.roll, appetizers: [...preset.appetizers], specials: [...preset.specials], dessert: preset.dessert };
  } else {
    menu = {
      roll: config.roll,
      appetizers: [...(config.appetizers ?? [])],
      specials: [...(config.specials ?? [])],
      dessert: config.dessert,
    };
  }

  validateMenu(menu, playerCount);
  return menu;
}

/** Validate menu composition and player-count restrictions. */
function validateMenu(menu, playerCount) {
  if (!ROLLS.includes(menu.roll))
    throw new Error(`invalid roll: ${menu.roll}`);
  if (!Array.isArray(menu.appetizers) || menu.appetizers.length !== 3)
    throw new Error('menu requires exactly 3 appetizers');
  if (new Set(menu.appetizers).size !== 3)
    throw new Error('appetizers must be distinct');
  for (const a of menu.appetizers)
    if (!APPETIZERS.includes(a)) throw new Error(`invalid appetizer: ${a}`);
  if (!Array.isArray(menu.specials) || menu.specials.length !== 2)
    throw new Error('menu requires exactly 2 specials');
  if (new Set(menu.specials).size !== 2)
    throw new Error('specials must be distinct');
  for (const s of menu.specials)
    if (!SPECIALS.includes(s)) throw new Error(`invalid special: ${s}`);
  if (!DESSERTS.includes(menu.dessert))
    throw new Error(`invalid dessert: ${menu.dessert}`);

  const restricted = restrictedTypes(playerCount);
  const used = [menu.roll, ...menu.appetizers, ...menu.specials, menu.dessert];
  for (const t of used)
    if (restricted.has(t))
      throw new Error(`card '${t}' not allowed in a ${playerCount}-player game`);

  return true;
}

/** The card types (excluding dessert) that form the base draw deck. */
function menuTypes(menu) {
  return ['nigiri', menu.roll, ...menu.appetizers, ...menu.specials];
}

/** Build the base (non-dessert) deck for a menu — full counts of each type. */
function baseDeck(menu) {
  return menuTypes(menu).flatMap(cardsOfType);
}

/** All dessert cards of the menu's dessert type (full pool of 15). */
function dessertPool(menu) {
  return cardsOfType(menu.dessert);
}

// --- Deterministic RNG (mulberry32) & shuffle ---

/** Create a seeded PRNG returning floats in [0, 1). */
function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle. Returns a new array; does not mutate input. */
function shuffle(array, rng = Math.random) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = {
  MENUS,
  dealCount,
  dessertCount,
  restrictedTypes,
  resolveMenu,
  validateMenu,
  menuTypes,
  baseDeck,
  dessertPool,
  makeRng,
  shuffle,
};
