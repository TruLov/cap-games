/**
 * Flip Fortune - turn engine (pure, no CAP imports).
 *
 * One active player at a time takes a single decision per turn: Hit (flip the
 * top card) or Stay (bank, out for the round). Flipping a duplicate number busts
 * you (0 for the round) unless you hold a Second Chance. Collecting 7 unique
 * numbers is a Flip 7 - it ends the round immediately and adds +15. First to the
 * target total (default 200) with the sole highest score wins; a tie at the top
 * plays another round.
 *
 * Deal note: rather than a separate up-front deal (which in the physical game can
 * trigger action cards mid-deal), each round simply starts in play and a player
 * may not Stay on an empty line - so everyone takes at least one flip, resolving
 * any action cards through the normal in-turn machinery. A deliberate, faithful
 * simplification (documented in the README).
 *
 * Action cards resolve when flipped:
 *   - Freeze / Flip Three → the flipper picks a still-active target (a `pending`
 *     decision resolved with { action:'resolve', target }).
 *   - Second Chance → kept automatically; a duplicate second one is given to an
 *     eligible player (pending) or discarded.
 * A Flip Three's three forced flips are resolved automatically by the engine
 * (pausing only when one of them is itself an action needing a target), with a
 * small stack so a Flip Three drawn during a Flip Three unwinds correctly.
 */

import { buildDeck, shuffle, MOD_VALUE } from './deck.js';
import { scoreRound, resolveWinner } from './scoring.js';

const DEFAULT_TARGET = 200;
const ok = state => ({ state, end: null });

const freshLine = () => ({ cards: [], numbers: [], status: 'active', secondChance: false, flip7: false });

// ---- setup ----------------------------------------------------------------

export function init(settings = {}, players = [], rng = Math.random) {
  const ids = players.length ? players.map(p => p.user ?? p) : (settings.players ?? []);
  const target = [100, 200, 300].includes(settings.target) ? settings.target : DEFAULT_TARGET;
  return {
    players: ids,
    startIdx: 0,
    currentIdx: 0,
    turn: ids[0] ?? null,
    scores: Object.fromEntries(ids.map(u => [u, 0])),
    target,
    round: 1,
    lines: Object.fromEntries(ids.map(u => [u, freshLine()])),
    drawPile: shuffle(buildDeck(), rng),
    discardPile: [],
    pending: null,          // { type:'freeze'|'flipthree'|'givesecond', by, card? }
    forced: null,           // { idx, remaining } - current auto forced-flip context
    forcedStack: [],        // suspended forced contexts (nested Flip Three)
    resumeIdx: null,        // where normal play resumes once all forced work is done
    phase: 'playing',       // 'playing' | 'done'
    lastCard: null,         // { user, card } - for the flip animation
    roundSummary: null,     // per-player breakdown of the last finished round
    winner: null,
  };
}

// ---- move dispatch --------------------------------------------------------

export function applyMove(prev, move, user, rng = Math.random) {
  if (prev.winner || prev.phase === 'done') return { error: 'game over' };
  const state = structuredClone(prev);
  if (state.turn !== user) return { error: 'not your turn' };

  if (state.pending) {
    if (move?.action !== 'resolve') return { error: 'resolve the action card first' };
    return doResolve(state, user, move, rng);
  }
  const line = state.lines[user];
  switch (move?.action) {
    case 'hit':
      if (line.status !== 'active') return { error: 'you are out this round' };
      return doHit(state, user, rng);
    case 'stay':
      if (line.status !== 'active') return { error: 'you are out this round' };
      if (line.cards.length === 0) return { error: 'flip at least one card before staying' };
      line.status = 'stayed';
      return advanceTurn(state, state.currentIdx, rng);
    default:
      return { error: `unknown action: ${move?.action}` };
  }
}

function doHit(state, user, rng) {
  flipOnto(state, user, rng);
  if (state.pending) return ok(state);                     // action drawn → resolve it
  if (state.lines[user].flip7) return endRound(state, rng);
  return advanceTurn(state, state.currentIdx, rng);        // one flip per turn
}

function doResolve(state, user, move, rng) {
  const p = state.pending;
  if (p.by !== user) return { error: 'not your decision' };
  const flipperIdx = state.currentIdx;
  const target = move.target;
  state.pending = null;

  if (p.type === 'freeze') {
    if (!isActive(state, target)) return revert(state, 'invalid target', p);
    state.lines[target].status = 'frozen';
    state.discardPile.push(p.card);                  // spent action card → discard
    return state.forced ? processAuto(state, rng) : advanceTurn(state, flipperIdx, rng);
  }
  if (p.type === 'flipthree') {
    if (!isActive(state, target)) return revert(state, 'invalid target', p);
    state.discardPile.push(p.card);                  // spent action card → discard
    startForced(state, idxOf(state, target), flipperIdx);
    return processAuto(state, rng);
  }
  if (p.type === 'givesecond') {
    if (!eligibleForGive(state, user).includes(target)) return revert(state, 'invalid target', p);
    state.lines[target].secondChance = true;
    state.lines[target].cards.push(p.card);
    return state.forced ? processAuto(state, rng) : advanceTurn(state, flipperIdx, rng);
  }
  return revert(state, 'unknown pending', p);
}

const revert = (state, error, pending) => { state.pending = pending; return { error }; };

// ---- flipping a card onto a line ------------------------------------------

function drawCard(state, rng) {
  if (state.drawPile.length === 0) {
    const source = state.discardPile.length ? state.discardPile : buildDeck();
    state.drawPile = shuffle(source, rng);
    state.discardPile = [];
  }
  return state.drawPile.pop();
}

// Draw one card and apply it to `user`'s line. May set state.pending (action
// needing a target), bust the line, or trigger a Flip 7. Never advances turn.
function flipOnto(state, user, rng) {
  const line = state.lines[user];
  const card = drawCard(state, rng);
  state.lastCard = { user, card };

  if (card.kind === 'number') {
    if (line.numbers.includes(card.value)) {
      if (line.secondChance) {                       // cancel the bust
        line.secondChance = false;
        removeCard(line, c => c.kind === 'action' && c.action === 'secondchance');
        state.discardPile.push(card, { kind: 'action', action: 'secondchance' });
      } else {
        line.status = 'busted';
        state.discardPile.push(card);
      }
    } else {
      line.numbers.push(card.value);
      line.cards.push(card);
      if (line.numbers.length === 7) line.flip7 = true;
    }
  } else if (card.kind === 'modifier') {
    line.cards.push(card);
  } else {                                            // action
    if (card.action === 'secondchance') {
      if (!line.secondChance) { line.secondChance = true; line.cards.push(card); }
      else if (eligibleForGive(state, user).length) state.pending = { type: 'givesecond', by: user, card };
      else state.discardPile.push(card);
    } else {
      state.pending = { type: card.action, by: user, card };  // 'freeze' | 'flipthree'
    }
  }
}

// ---- forced flips (Flip Three) --------------------------------------------

function startForced(state, targetIdx, flipperIdx) {
  if (state.forced) {
    if (targetIdx === state.forced.idx) { state.forced.remaining += 3; return; }
    state.forcedStack.push(state.forced);
  } else {
    state.resumeIdx = flipperIdx;                     // resume normal play here afterwards
  }
  state.forced = { idx: targetIdx, remaining: 3 };
  setTurn(state, targetIdx);
}

// Auto-resolve owed forced flips, pausing on a nested action. When all forced
// work is done, resume normal play from resumeIdx.
function processAuto(state, rng) {
  for (;;) {
    while (state.forced && state.forced.remaining > 0) {
      const u = state.players[state.forced.idx];
      flipOnto(state, u, rng);
      state.forced.remaining--;                       // every draw counts as one flip
      if (state.pending) return ok(state);            // (incl. a nested action card)
      const line = state.lines[u];
      if (line.status === 'busted' || line.flip7) state.forced.remaining = 0;
    }
    if (state.pending) return ok(state);
    if (state.forced && state.forcedStack.length) {   // unwind a suspended context
      state.forced = state.forcedStack.pop();
      setTurn(state, state.forced.idx);
      continue;
    }
    state.forced = null;
    const from = state.resumeIdx;
    state.resumeIdx = null;
    return advanceTurn(state, from, rng);
  }
}

// ---- turn advancement & round end -----------------------------------------

function advanceTurn(state, fromIdx, rng) {
  if (state.players.some(u => state.lines[u].flip7)) return endRound(state, rng);
  const next = nextActiveIdx(state, fromIdx);
  if (next === -1) return endRound(state, rng);
  setTurn(state, next);
  return ok(state);
}

function endRound(state, _rng) {
  const summary = state.players.map(u => {
    const line = state.lines[u];
    const r = scoreRound(line);
    const before = state.scores[u] ?? 0;
    return {
      user: u, points: r.points, busted: r.busted, lines: r.lines,
      flip7: line.flip7, cards: line.cards.map(c => ({ ...c })),
      before, after: before + r.points,
    };
  });
  for (const s of summary) state.scores[s.user] = s.after;
  for (const u of state.players) state.discardPile.push(...state.lines[u].cards);
  state.roundSummary = summary;
  state.pending = null; state.forced = null; state.forcedStack = []; state.resumeIdx = null;

  const winner = resolveWinner(state.scores, state.players, state.target);
  if (winner) {
    state.phase = 'done';
    state.winner = winner;
    return { state, end: { winner, scores: { ...state.scores } } };
  }
  // next round - the deck continues (discards reshuffle when the draw pile empties)
  state.round += 1;
  state.startIdx = (state.startIdx + 1) % state.players.length;
  for (const u of state.players) state.lines[u] = freshLine();
  state.lastCard = null;
  setTurn(state, state.startIdx);
  return ok(state);
}

// No leaderboard scorer here: the win/loss mapping is the platform's
// defaultScore (resolveWinner only ever yields a single winner, never 'draw'),
// and the real per-player points come from end.scores via the game's pointsOf
// hook (see game.js). end.winner is a single user id.

// ---- helpers --------------------------------------------------------------

const idxOf = (state, user) => state.players.indexOf(user);
const isActive = (state, user) => state.lines[user]?.status === 'active';
const setTurn = (state, idx) => { state.currentIdx = idx; state.turn = state.players[idx]; };

function nextActiveIdx(state, fromIdx) {
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (fromIdx + i) % n;
    if (state.lines[state.players[idx]].status === 'active') return idx;
  }
  return -1;
}

function removeCard(line, pred) {
  const i = line.cards.findIndex(pred);
  if (i >= 0) line.cards.splice(i, 1);
}

// Players (other than `by`) still in the round without a Second Chance.
function eligibleForGive(state, by) {
  return state.players.filter(u => u !== by && state.lines[u].status === 'active' && !state.lines[u].secondChance);
}

export { MOD_VALUE };
