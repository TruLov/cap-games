/**
 * Kaperfahrt — turn engine (pure, no CAP imports).
 *
 * One active player at a time takes many sub-moves within a turn: draw a card
 * (automatic), roll all 8 dice, then repeatedly reroll >= 2 active dice or stop
 * and bank the score. A third skull busts the turn (score 0, except dice locked
 * in a treasure chest). First player to reach the target triggers a final round
 * so everyone has had an equal number of turns; highest total then wins.
 *
 * Die shape: { face, status }
 *   status 'active' — rollable/rerollable, not a skull
 *          'skull'  — a skull, locked, counts toward the bust
 *          'locked' — a fixed scoring die (the coin/diamond card's 9th die)
 *          'chest'  — stored in the treasure chest; scores even on a bust
 *
 * Island of Skulls: 4+ skulls on the *first* roll of a turn send the active
 * player to the island (phase 'island') instead of busting. There they keep
 * rerolling the non-skull dice; every new skull docks 100 points from each of
 * the *other* players, and the active player scores nothing. The island turn
 * ends the moment a roll adds no new skull.
 */

import { rollFace, scoreBreakdown, skullCount, maxSet } from './dice.js';
import { drawCard } from './deck.js';

const DEFAULT_TARGET = 6000;

// ---- turn setup -----------------------------------------------------------

function freshDice(card) {
  const dice = [];
  const preSkulls = card.type === 'curse' ? card.skulls : 0;
  for (let i = 0; i < 8; i++) {
    dice.push(i < preSkulls ? { face: 'skull', status: 'skull' } : { face: null, status: 'active' });
  }
  if (card.type === 'coin') dice.push({ face: 'coin', status: 'locked' });
  if (card.type === 'diamond') dice.push({ face: 'diamond', status: 'locked' });
  return dice;
}

function beginTurn(state, rng) {
  const card = drawCard(rng);
  return {
    ...state,
    card,
    dice: freshDice(card),
    sorceressUsed: false,
    rerollCount: 0,
    islandSkulls: 0,
    phase: 'awaitRoll',
  };
}

export function init(settings = {}, players = [], rng = Math.random) {
  const ids = players.map(p => p.user);
  const base = {
    players: ids,
    currentIdx: 0,
    turn: ids[0] ?? null,
    scores: Object.fromEntries(ids.map(u => [u, 0])),
    target: Number.isInteger(settings.target) ? settings.target : DEFAULT_TARGET,
    finalRoundActive: false,
    winner: null,
    lastTurn: null,
    log: [],
  };
  return beginTurn(base, rng);
}

// ---- rolling --------------------------------------------------------------

function rollDice(dice, indices, rng) {
  const next = dice.map(d => ({ ...d }));
  for (const i of indices) {
    const face = rollFace(rng);
    next[i].face = face;
    next[i].status = face === 'skull' ? 'skull' : 'active';
  }
  return next;
}

// After any roll, resolve instant win / bust or continue the turn.
function settle(state, rng) {
  if (maxSet(state.dice, state.card) >= 9) return finishGame(state, state.turn);
  if (skullCount(state.dice) >= 3) return endTurn(state, true, rng);
  return { state, end: null };
}

// ---- move dispatch --------------------------------------------------------

export function applyMove(state, move, user, rng = Math.random) {
  if (state.winner) return { error: 'game over' };
  if (user !== state.turn) return { error: 'not your turn' };

  if (state.phase === 'island') {
    return move?.action === 'roll' ? doIslandRoll(state, rng) : { error: 'keep rolling to leave the island' };
  }

  switch (move?.action) {
    case 'roll':      return doRoll(state, rng);
    case 'reroll':    return doReroll(state, move, rng);
    case 'sorceress': return doSorceress(state, move, rng);
    case 'chest':     return doChest(state, move);
    case 'stop':      return endTurn(state, false, rng);
    default:          return { error: `unknown action: ${move?.action}` };
  }
}

function doRoll(state, rng) {
  if (state.phase !== 'awaitRoll') return { error: 'already rolled this turn' };
  const active = indicesWithStatus(state.dice, 'active');
  const before = skullCount(state.dice);
  const dice = rollDice(state.dice, active, rng);
  const rolled = { ...state, dice, phase: 'rolling' };
  // 9-of-a-kind instant win takes priority over everything.
  if (maxSet(dice, state.card) >= 9) return finishGame(rolled, state.turn);
  // Island of Skulls: 4+ skulls on the *first* throw (else fall through to the
  // normal bust-at-3 in settle). Only the skulls actually rolled are penalised.
  if (skullCount(dice) >= 4) return enterIsland(rolled, skullCount(dice) - before);
  return settle(rolled, rng);
}

// ---- Island of Skulls -----------------------------------------------------

function dockOpponents(scores, players, active, skulls) {
  const next = { ...scores };
  for (const u of players) if (u !== active) next[u] = (next[u] ?? 0) - 100 * skulls;
  return next;
}

function enterIsland(state, rolledSkulls) {
  const scores = dockOpponents(state.scores, state.players, state.turn, rolledSkulls);
  return { state: { ...state, scores, phase: 'island', islandSkulls: rolledSkulls }, end: null };
}

function doIslandRoll(state, rng) {
  const active = indicesWithStatus(state.dice, 'active');
  const before = skullCount(state.dice);
  const dice = rollDice(state.dice, active, rng);
  const newSkulls = skullCount(dice) - before;
  if (newSkulls <= 0) return endIslandTurn({ ...state, dice }, rng);
  const scores = dockOpponents(state.scores, state.players, state.turn, newSkulls);
  return { state: { ...state, dice, scores, islandSkulls: state.islandSkulls + newSkulls }, end: null };
}

function doReroll(state, move, rng) {
  if (state.phase !== 'rolling') return { error: 'roll first' };
  const idx = move.dice;
  if (!Array.isArray(idx) || idx.length < 2) return { error: 'a reroll must include at least 2 dice' };
  for (const i of idx) {
    if (!validIndex(state.dice, i)) return { error: 'invalid die index' };
    if (state.dice[i].status !== 'active') return { error: 'can only reroll active dice' };
  }
  const dice = rollDice(state.dice, idx, rng);
  return settle({ ...state, dice, rerollCount: state.rerollCount + 1 }, rng);
}

function doSorceress(state, move, rng) {
  if (state.phase !== 'rolling') return { error: 'roll first' };
  if (state.card.type !== 'sorceress') return { error: 'no sorceress this turn' };
  if (state.sorceressUsed) return { error: 'sorceress already used' };
  const idx = move.dice;
  if (!Array.isArray(idx) || idx.length < 1) return { error: 'choose at least one die' };
  for (const i of idx) {
    if (!validIndex(state.dice, i)) return { error: 'invalid die index' };
    const s = state.dice[i].status;
    if (s !== 'active' && s !== 'skull') return { error: 'cannot reroll that die' };
  }
  const dice = rollDice(state.dice, idx, rng);
  return settle({ ...state, dice, sorceressUsed: true }, rng);
}

function doChest(state, move) {
  if (state.phase !== 'rolling') return { error: 'roll first' };
  if (state.card.type !== 'chest') return { error: 'no treasure chest this turn' };
  const idx = move.dice;
  if (!Array.isArray(idx) || !idx.length) return { error: 'choose dice to store' };
  const dice = state.dice.map(d => ({ ...d }));
  for (const i of idx) {
    if (!validIndex(dice, i)) return { error: 'invalid die index' };
    if (dice[i].status !== 'active') return { error: 'can only store active dice' };
    dice[i].status = 'chest';
  }
  return { state: { ...state, dice }, end: null };
}

// ---- turn resolution ------------------------------------------------------

// Points banked for the just-finished turn (may be negative on a lost battle),
// plus an itemised breakdown for the turn-end summary.
function scoreTurn(state, busted) {
  const card = state.card;
  const eligible = busted ? state.dice.filter(d => d.status === 'chest') : state.dice;
  const base = scoreBreakdown(eligible, card);

  if (card.type === 'seabattle') {
    const sabers = eligible.filter(d => d.face === 'saber').length;
    if (!busted && sabers >= card.need) {
      return { points: base.total + card.bonus, lines: [...base.lines, { label: `Sea battle won`, points: card.bonus }] };
    }
    return { points: -card.bonus, lines: [{ label: busted ? 'Busted at sea' : 'Sea battle lost', points: -card.bonus }] };
  }
  if (busted) return { points: base.total, lines: base.lines };            // chest-only (0 if nothing stored)
  if (card.type === 'captain') return { points: base.total * 2, lines: [...base.lines, { label: 'Captain', mult: 2 }] };
  return { points: base.total, lines: base.lines };
}

function endTurn(state, busted, rng) {
  const { points, lines } = scoreTurn(state, busted);
  const scores = { ...state.scores, [state.turn]: (state.scores[state.turn] ?? 0) + points };
  const dice = state.dice.map(d => ({ face: d.face, status: d.status }));
  const lastTurn = { user: state.turn, card: state.card, points, busted, breakdown: lines, dice };
  const log = pushLog(state.log, logEntry(state, { points, busted, island: false }));
  return advanceOrFinish({ ...state, scores, lastTurn, log }, rng);
}

// Island turns bank 0 for the active player (opponents were already docked
// during the rolls); the game can still end here if it was the final round.
function endIslandTurn(state, rng) {
  const lastTurn = {
    user: state.turn, card: state.card, points: 0, busted: false,
    island: true, skulls: state.islandSkulls,
    breakdown: [{ label: `${state.islandSkulls} skulls`, points: -100 * state.islandSkulls, perRival: true }],
    dice: state.dice.map(d => ({ face: d.face, status: d.status })),
  };
  const log = pushLog(state.log, logEntry(state, { points: 0, busted: false, island: true, skulls: state.islandSkulls }));
  return advanceOrFinish({ ...state, lastTurn, log }, rng);
}

function advanceOrFinish(state, rng) {
  const n = state.players.length;
  const finalRoundActive = state.finalRoundActive || (state.scores[state.turn] ?? 0) >= state.target;
  const nextIdx = (state.currentIdx + 1) % n;

  // The final round completes when play wraps back to the first player.
  if (finalRoundActive && nextIdx === 0) {
    return finishGame({ ...state, finalRoundActive }, winnerByScore(state.scores, state.players));
  }

  const advanced = { ...state, finalRoundActive, currentIdx: nextIdx, turn: state.players[nextIdx] };
  return { state: beginTurn(advanced, rng), end: null };
}

// ---- roll log (per-turn summary, newest first, bounded) -------------------

const LOG_MAX = 20;

function logEntry(state, result) {
  return {
    user: state.turn,
    card: state.card,
    dice: state.dice.map(d => ({ face: d.face, status: d.status })),
    ...result,
  };
}

function pushLog(log = [], entry) {
  return [entry, ...log].slice(0, LOG_MAX);
}

function finishGame(state, winner) {
  return {
    state: { ...state, winner, phase: 'done' },
    end: { winner, scores: state.scores },
  };
}

function winnerByScore(scores, players) {
  let best = -Infinity, winner = null, tie = false;
  for (const u of players) {
    const s = scores[u] ?? 0;
    if (s > best) { best = s; winner = u; tie = false; }
    else if (s === best) tie = true;
  }
  return tie ? 'draw' : winner;
}

// ---- leaderboard scoring --------------------------------------------------

export function score(end, players) {
  return players
    .filter(p => !p.spectator)
    .map(p => {
      const draw = end.winner === 'draw';
      const win = !draw && p.user === end.winner;
      return {
        user: p.user,
        result: draw ? 'draw' : (win ? 'win' : 'loss'),
        points: draw ? 1 : (win ? 3 : 0),
      };
    });
}

// ---- helpers --------------------------------------------------------------

const validIndex = (dice, i) => Number.isInteger(i) && i >= 0 && i < dice.length;
const indicesWithStatus = (dice, status) =>
  dice.map((d, i) => (d.status === status ? i : -1)).filter(i => i >= 0);
