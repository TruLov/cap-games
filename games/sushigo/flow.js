/**
 * Sushi Go Party! — Game flow engine.
 *
 * Implements the platform game contract's stateful core:
 *   init(settings) -> state
 *   applyMove(state, move, symbol) -> { state, end } | { error }
 *
 * The platform's `move` handler does NOT enforce turn order — it delegates all
 * validity to this module. Sushi Go is a *simultaneous* game, so applyMove
 * buffers each player's selection into `state.pending` and only resolves the
 * turn once every active player has selected.
 *
 * Pure logic. No CAP imports. `state` is JSON-serializable (the platform
 * stringifies it into WebSocket events).
 */

'use strict';

const deck = require('./deck');
const { scoreRound, scoreGame } = require('./scoring');

const URAMAKI_THRESHOLD = 10;

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

/**
 * @param settings {
 *   players: string[]        // ordered player symbols (from platform join)
 *   preset?: string          // predefined menu id
 *   roll?, appetizers?, specials?, dessert?  // custom menu
 *   seed?: number            // deterministic RNG seed (tests)
 * }
 */
function init(settings = {}) {
  const symbols = settings.players ?? [];
  if (symbols.length < 2) throw new Error('need at least 2 players');
  const playerCount = symbols.length;

  const menu = deck.resolveMenu(settings, playerCount);
  const seed = settings.seed ?? (Date.now() >>> 0);

  const state = {
    phase: 'playing',
    turn: 'all',                       // sentinel — simultaneous game
    menu,
    playerCount,
    symbols,
    round: 1,
    seed,
    dealNo: 0,                         // increments each shuffle for deterministic RNG
    hands:    Object.fromEntries(symbols.map(s => [s, []])),
    played:   Object.fromEntries(symbols.map(s => [s, []])),
    desserts: Object.fromEntries(symbols.map(s => [s, []])),
    pending:  {},
    menuOffer: {},                    // symbol -> 4 cards revealed by a Menu (private)
    menuHold:  {},                    // symbol -> the Menu card set aside during a choice
    dessertsUsed: 0,                   // how many dessert cards already inserted
    dessertPool: deck.dessertPool(menu),
    drawPile: [],
    uramakiPlaceIndex: 0,
    roundScores: Object.fromEntries(symbols.map(s => [s, []])),
    totals: Object.fromEntries(symbols.map(s => [s, 0])),
    history: Object.fromEntries(symbols.map(s => [s, []])),    // per-round card snapshots
    dessertScores: Object.fromEntries(symbols.map(s => [s, 0])), // end-of-game dessert pts
  };

  dealRound(state);
  return state;
}

/** Build & deal a fresh round's deck into hands. */
function dealRound(state) {
  const { menu, playerCount, round } = state;
  const rng = deck.makeRng(state.seed + state.dealNo++ * 7919);

  // base (non-dessert) deck + this round's dessert cards
  const need = deck.dessertCount(playerCount, round);
  const desserts = state.dessertPool.slice(state.dessertsUsed, state.dessertsUsed + need);
  state.dessertsUsed += desserts.length;

  const pile = deck.shuffle([...deck.baseDeck(menu), ...desserts], rng);
  const handSize = deck.dealCount(playerCount);

  for (const s of state.symbols) {
    state.hands[s] = pile.splice(0, handSize);
  }
  state.drawPile = pile;
  state.uramakiPlaceIndex = 0;
  state.pending = {};
}

// ---------------------------------------------------------------------------
// applyMove
// ---------------------------------------------------------------------------

function applyMove(state, move, symbol) {
  if (state.phase !== 'playing') return { error: 'game is not in progress' };
  if (!state.symbols.includes(symbol)) return { error: 'not a player in this game' };

  // Menu — step 2: choosing one of the 4 offered cards
  if (move && move.menuChoice != null) return resolveMenuChoice(state, symbol, move.menuChoice);

  // must finish an in-progress Menu before doing anything else
  if (state.menuOffer && state.menuOffer[symbol]) return { error: 'resolve your Menu selection first' };

  if (state.pending[symbol]) return { error: 'you have already selected this turn' };

  const hand = state.hands[symbol];
  const err = validateSelection(state, hand, move, symbol);
  if (err) return { error: err };

  // Menu — step 1: reveal 4 cards from the draw pile for this player to choose from
  if (move.bonus === 'menu') return offerMenu(state, symbol, move);

  state.pending[symbol] = move;

  // Not everyone has selected yet → wait (broadcast keeps players in sync).
  if (Object.keys(state.pending).length < state.symbols.length) {
    return { state, end: null };
  }

  return resolveTurn(state);
}

/** Validate a player's selection against their current hand. */
function validateSelection(state, hand, move, symbol) {
  if (!move || typeof move.pick !== 'number') return 'must pick a card';
  if (move.pick < 0 || move.pick >= hand.length) return 'invalid card index';

  if (move.bonus === 'menu') {
    if (hand[move.pick].type !== 'menu') return 'that card is not a Menu';
    return null;
  }

  if (move.pick2 != null) {
    // Chopsticks: play a second card. Requires an unused chopsticks already played.
    if (!hasUnusedChopsticks(state, symbol)) return 'no chopsticks to use';
    if (move.pick2 < 0 || move.pick2 >= hand.length) return 'invalid second card index';
    if (move.pick2 === move.pick) return 'cannot pick the same card twice';
    if (hand.length < 2) return 'not enough cards for chopsticks';
  }

  if (move.bonus === 'spoon') {
    if (!hasUnusedSpoon(state, symbol)) return 'no spoon to use';
    if (typeof move.cardType !== 'string' || !move.cardType) return 'name a card type for spoon';
  }
  return null;
}

function hasUnusedChopsticks(state, symbol) {
  return state.played[symbol]?.some(c => c.type === 'chopsticks') ?? false;
}

function hasUnusedSpoon(state, symbol) {
  return state.played[symbol]?.some(c => c.type === 'spoon') ?? false;
}

// --- Menu (two-phase) ------------------------------------------------------

/** Menu step 1: set aside the Menu card and reveal up to 4 cards from the pile. */
function offerMenu(state, symbol, move) {
  state.menuOffer ??= {};
  state.menuHold ??= {};
  const menuCard = state.hands[symbol].splice(move.pick, 1)[0];
  state.menuHold[symbol] = menuCard;
  state.menuOffer[symbol] = state.drawPile.splice(0, 4);
  return { state, end: null };
}

/** Menu step 2: play the chosen card, return the rest, discard the Menu card. */
function resolveMenuChoice(state, symbol, idx) {
  const offer = state.menuOffer && state.menuOffer[symbol];
  if (!offer) return { error: 'no Menu selection in progress' };
  if (!Number.isInteger(idx) || idx < 0 || idx >= offer.length) return { error: 'invalid Menu choice' };
  const chosen = offer[idx];
  if (chosen.type === 'menu') return { error: 'cannot choose another Menu' };

  placeCard(state, symbol, chosen, {});
  state.drawPile.push(...offer.filter((_, i) => i !== idx));
  delete state.menuOffer[symbol];
  delete state.menuHold[symbol];

  state.pending[symbol] = { menu: true };
  if (Object.keys(state.pending).length < state.symbols.length) return { state, end: null };
  return resolveTurn(state);
}

// ---------------------------------------------------------------------------
// turn resolution
// ---------------------------------------------------------------------------

function resolveTurn(state) {
  // 1. Each player reveals & places their selected card(s).
  for (const s of state.symbols) {
    const move = state.pending[s];
    if (move.menu) continue; // card already placed during the Menu choice
    const hand = state.hands[s];

    const picks = [move.pick];
    if (move.pick2 != null) picks.push(move.pick2);

    // remove picked cards (high index first to keep indices valid)
    const chosen = [...picks].sort((a, b) => b - a).map(i => hand.splice(i, 1)[0]);
    chosen.reverse(); // back to selection order

    // if chopsticks was used, return one chopsticks card to the hand
    if (move.pick2 != null) {
      const idx = state.played[s].findIndex(c => c.type === 'chopsticks');
      if (idx >= 0) hand.push(state.played[s].splice(idx, 1)[0]);
    }

    for (const card of chosen) placeCard(state, s, card, move);
  }

  // 2. Spoon: pull a named card from a neighbour's hand (after normal picks).
  processSpoons(state);

  // 3. Miso Soup: if 2+ were played on the SAME turn, all are discarded (score 0).
  const misoJustPlayed = state.symbols.flatMap(
    s => state.played[s].filter(c => c.type === 'miso' && c._justPlayed));
  if (misoJustPlayed.length >= 2) {
    for (const s of state.symbols)
      state.played[s] = state.played[s].filter(c => !(c.type === 'miso' && c._justPlayed));
  }
  for (const s of state.symbols)
    for (const c of state.played[s]) delete c._justPlayed;

  // 4. Uramaki mid-round scoring (threshold reached).
  awardUramakiMidRound(state);

  // 5. Rotate remaining hands to the next neighbor (pass left).
  rotateHands(state);

  // 6. Clear selections.
  state.pending = {};

  // 7. Round over when all hands are empty.
  if (state.symbols.every(s => state.hands[s].length === 0)) {
    return endRound(state);
  }
  return { state, end: null };
}

/**
 * Resolve Spoon bonus actions. For each player who called "spoon" and named a
 * card type, take one such card from the first left-neighbour who still holds it,
 * play it, and hand the Spoon to that neighbour. If nobody has it, discard the
 * Spoon. Processed in seating order so earlier spoons deplete hands first.
 */
function processSpoons(state) {
  const { symbols } = state;
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i];
    const move = state.pending[s];
    if (!move || move.bonus !== 'spoon') continue;

    const spoonIdx = state.played[s].findIndex(c => c.type === 'spoon');
    if (spoonIdx < 0) continue; // guarded at validation, defensive here

    let taken = null, giver = null;
    for (let k = 1; k < symbols.length; k++) {
      const t = symbols[(i + k) % symbols.length];
      const ci = state.hands[t].findIndex(c => c.type === move.cardType);
      if (ci >= 0) { taken = state.hands[t].splice(ci, 1)[0]; giver = t; break; }
    }

    const spoon = state.played[s].splice(spoonIdx, 1)[0];
    if (taken) {
      placeCard(state, s, taken, {});
      state.played[giver].push(spoon); // give the Spoon to the giver (unused)
    } // else the Spoon is discarded
  }
}

/** Place a card into a player's tableau, applying placement rules. */
function placeCard(state, symbol, card, move) {
  const played = state.played[symbol];

  switch (card.type) {
    case 'nigiri': {
      // must go on an unoccupied Wasabi if one exists → tripled
      const wasabi = played.find(c => c.type === 'wasabi' && !c.occupied);
      if (wasabi) { wasabi.occupied = true; card.onWasabi = true; }
      played.push(card);
      return;
    }
    case 'special_order': {
      // copy a previously played card (move.target = index into played)
      const target = played[move?.target];
      if (target && target.type !== 'special_order') {
        played.push({ ...structuredClone(target), copiedFrom: 'special_order' });
      } // else discarded (no valid target)
      return;
    }
    case 'takeout_box': {
      // flip chosen previously-played cards (move.flips = indices)
      for (const i of move?.flips ?? []) {
        if (played[i]) played[i].flipped = true;
      }
      return; // takeout_box itself is discarded
    }
    case 'miso':
      card._justPlayed = true;
      played.push(card);
      return;
    default:
      played.push(card);
  }
}

/** Award Uramaki places to players crossing the 10-icon threshold this turn. */
function awardUramakiMidRound(state) {
  const points = [8, 5, 2];
  const iconsOf = s => state.played[s]
    .filter(c => c.type === 'uramaki' && !c.flipped)
    .reduce((sum, c) => sum + c.icons, 0);

  const crossed = state.symbols
    .map(s => ({ s, icons: iconsOf(s) }))
    .filter(x => x.icons >= URAMAKI_THRESHOLD)
    .sort((a, b) => b.icons - a.icons);

  if (crossed.length === 0) return;

  // group by icon count so ties share a place; next place is then skipped
  let i = 0;
  while (i < crossed.length && state.uramakiPlaceIndex < points.length) {
    const tieIcons = crossed[i].icons;
    const group = crossed.filter(x => x.icons === tieIcons);
    const pts = points[state.uramakiPlaceIndex];
    for (const g of group) {
      state.totals[g.s] += pts;
      const rs = state.roundScores[g.s];
      rs[state.round - 1] = (rs[state.round - 1] ?? 0) + pts;
      // discard scored uramaki cards
      state.played[g.s] = state.played[g.s].filter(c => c.type !== 'uramaki');
    }
    state.uramakiPlaceIndex += group.length; // ties consume that many places
    i += group.length;
  }
}

/** Pass each player's remaining hand to the next neighbor (to the left). */
function rotateHands(state) {
  const { symbols } = state;
  const n = symbols.length;
  const rotated = {};
  for (let i = 0; i < n; i++) {
    const from = symbols[i];
    const to = symbols[(i + 1) % n];
    rotated[to] = state.hands[from];
  }
  state.hands = rotated;
}

// ---------------------------------------------------------------------------
// round / game end
// ---------------------------------------------------------------------------

function endRound(state) {
  const roundTypes = ['nigiri', state.menu.roll, ...state.menu.appetizers, ...state.menu.specials];
  const players = boardPlayers(state);
  const roundPts = scoreRound(players, state.playerCount, state, roundTypes);

  for (const s of state.symbols) {
    const rs = state.roundScores[s];
    rs[state.round - 1] = (rs[state.round - 1] ?? 0) + roundPts[s];
    state.totals[s] += roundPts[s];
  }

  // Snapshot this round's played cards into history before discarding.
  for (const s of state.symbols) {
    state.history[s][state.round - 1] = state.played[s].map(c => ({ ...c }));
  }

  // Keep desserts in front of players; discard everything else.
  for (const s of state.symbols) {
    const desserts = state.played[s].filter(c => c.type === state.menu.dessert && !c.flipped);
    state.desserts[s].push(...desserts);
    state.played[s] = [];
  }

  if (state.round < 3) {
    state.round++;
    dealRound(state);
    return { state, end: null };
  }

  return endGame(state);
}

function endGame(state) {
  const players = boardPlayers(state);
  const dessertPts = scoreGame(players, state.playerCount, state.menu.dessert);
  for (const s of state.symbols) {
    state.dessertScores[s] = dessertPts[s];
    state.totals[s] += dessertPts[s];
  }

  state.phase = 'gameOver';
  const ranking = computeRanking(state);
  state.ranking = ranking;

  const topScore = ranking[0].score;
  const topDesserts = ranking[0].desserts;
  const winners = ranking.filter(r => r.score === topScore && r.desserts === topDesserts);
  const winner = winners.length === 1 ? winners[0].symbol : 'draw';

  return { state, end: { winner, ranking } };
}

/** Final ranking with the dessert-count tie-breaker. */
function computeRanking(state) {
  return state.symbols
    .map(s => ({
      symbol: s,
      score: state.totals[s],
      desserts: state.desserts[s].length,
    }))
    .sort((a, b) => b.score - a.score || b.desserts - a.desserts);
}

/** Shape the per-player boards the scoring module expects. */
function boardPlayers(state) {
  return state.symbols.map(s => ({
    symbol: s,
    played: state.played[s],
    desserts: state.desserts[s],
  }));
}

module.exports = { init, applyMove, dealRound, resolveTurn, computeRanking };
