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
 */

import { rollFace, scoreDice, skullCount, maxSet } from './dice.js';
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
  const dice = rollDice(state.dice, active, rng);
  return settle({ ...state, dice, phase: 'rolling' }, rng);
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

// Points banked for the just-finished turn (may be negative on a lost battle).
function turnScore(state, busted) {
  const card = state.card;
  const eligible = busted ? state.dice.filter(d => d.status === 'chest') : state.dice;
  const dicePoints = scoreDice(eligible, card);

  if (card.type === 'seabattle') {
    const sabers = eligible.filter(d => d.face === 'saber').length;
    if (!busted && sabers >= card.need) return dicePoints + card.bonus;
    return -card.bonus; // battle lost (or busted) → pay the penalty, no dice points
  }
  if (busted) return dicePoints;              // chest-only (0 if nothing stored)
  if (card.type === 'captain') return dicePoints * 2;
  return dicePoints;
}

function endTurn(state, busted, rng) {
  const points = turnScore(state, busted);
  const scores = { ...state.scores, [state.turn]: (state.scores[state.turn] ?? 0) + points };
  const lastTurn = { user: state.turn, card: state.card, points, busted };

  const n = state.players.length;
  const finalRoundActive = state.finalRoundActive || scores[state.turn] >= state.target;
  const nextIdx = (state.currentIdx + 1) % n;

  // The final round completes when play wraps back to the first player.
  if (finalRoundActive && nextIdx === 0) {
    return finishGame({ ...state, scores, lastTurn }, winnerByScore(scores, state.players));
  }

  const advanced = {
    ...state, scores, lastTurn, finalRoundActive,
    currentIdx: nextIdx, turn: state.players[nextIdx],
  };
  return { state: beginTurn(advanced, rng), end: null };
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
