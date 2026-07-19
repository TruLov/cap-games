/**
 * Kaffee-Kwest — decision-tree engine.
 *
 * Implements the stateful core of the platform game contract:
 *   init(settings) -> state
 *   applyMove(state, move, symbol) -> { state, end } | { error }
 *
 * The tree is frozen at prepare time (KaffeeKwestService.prepare) and only
 * walked here — no call can leave it. Like Kaiten, this is a *simultaneous*
 * game: `turn: 'all'` sentinel, votes are buffered until everyone (or the
 * host via forceVote) resolves the node.
 *
 * Pure logic. No CAP imports. `state` is JSON-serializable, including the
 * RNG (seed + counter), so dice rolls are deterministic and testable.
 *
 * Moves:
 *   { type: 'vote', option }   any player  — group decision, majority wins
 *   { type: 'forceVote' }      host only   — timeout substitute: resolve with cast votes
 *   { type: 'roll' }           named player — seeded d20 ± prepared bonus vs target
 *   { type: 'moment', text }   named player — free text, classified onto a fixed option
 */

// --- deterministic, serializable RNG -------------------------------------
function rand(state) {
  const x = Math.sin(state.seed * 9973 + ++state.rngN * 7919) * 10000;
  return x - Math.floor(x);
}

const node = state => state.tree.nodes[state.nodeId];

// --- init -----------------------------------------------------------------

/**
 * @param settings prepared by KaffeeKwestService.prepare():
 *   { scenario, title, party: [{symbol,user,isHost}], casting: {sym: {role,hook}},
 *     tree: { start, nodes }, sceneTotal, seed? (tests only) }
 */
function init(settings = {}) {
  const { party, tree } = settings;
  if (!Array.isArray(party) || party.length < 2)
    throw new Error('need at least 2 players — run prepare first');
  if (!tree?.start || !tree.nodes?.[tree.start])
    throw new Error('settings contain no decision tree — run prepare first');

  const symbols = party.map(p => p.symbol);
  const state = {
    turn: 'all',                       // sentinel — simultaneous game
    phase: 'playing',
    seed: settings.seed ?? (Date.now() >>> 0),   // fresh per init → rematch differs
    rngN: 0,
    scenario: settings.scenario,
    title: settings.title,
    symbols,
    host: party.find(p => p.isHost)?.symbol ?? symbols[0],
    party,
    casting: settings.casting ?? {},
    tree,
    nodeId: tree.start,
    sceneNo: 1,
    sceneTotal: settings.sceneTotal ?? 5,
    votes: {},                         // symbol -> option index (buffered)
    log: [],                           // the protocol — also the replayable game record
    ending: null,
  };
  state.log.push({ kind: 'scene', scene: 1, text: node(state).text });
  return state;
}

// --- applyMove ------------------------------------------------------------

function applyMove(state, move, symbol) {
  if (state.phase !== 'playing') return { error: 'round is over' };
  if (!state.symbols.includes(symbol)) return { error: 'not part of this party' };

  const n = node(state);
  switch (move?.type) {
    case 'vote':      return onVote(state, n, move, symbol);
    case 'forceVote': return onForceVote(state, n, symbol);
    case 'roll':      return onRoll(state, n, symbol);
    case 'moment':    return onMoment(state, n, move, symbol);
    default:          return { error: `unknown move type: ${move?.type}` };
  }
}

// --- mechanic 1: group decision ------------------------------------------

function onVote(state, n, move, symbol) {
  if (n.mechanic !== 'vote') return { error: 'no group decision pending' };
  const i = move.option;
  if (!Number.isInteger(i) || i < 0 || i >= n.options.length)
    return { error: 'invalid option' };

  state.votes[symbol] = i;   // re-voting before resolution is allowed

  if (Object.keys(state.votes).length < state.symbols.length)
    return { state, end: null };
  return resolveVote(state, n);
}

function onForceVote(state, n, symbol) {
  if (n.mechanic !== 'vote') return { error: 'no group decision pending' };
  if (symbol !== state.host) return { error: 'only the host can force a decision' };
  return resolveVote(state, n);
}

function resolveVote(state, n) {
  const tally = n.options.map((_, i) =>
    Object.values(state.votes).filter(v => v === i).length);
  const top = Math.max(...tally);
  const leaders = tally.flatMap((c, i) => (c === top && top > 0 ? [i] : []));

  let winner, note = '';
  if (leaders.length === 0) {          // forced with zero votes → fate decides
    winner = Math.floor(rand(state) * n.options.length);
    note = ' (das Schicksal entscheidet)';
  } else if (leaders.length > 1) {     // tie → narrated coin flip
    winner = leaders[Math.floor(rand(state) * leaders.length)];
    note = ' (Münzwurf des Schicksals)';
  } else {
    winner = leaders[0];
  }

  const opt = n.options[winner];
  state.log.push({ kind: 'result', text: `Die Gruppe entscheidet: ${opt.label}${note}` });
  return advance(state, opt.next);
}

// --- mechanic 2: d20 roll -------------------------------------------------

function onRoll(state, n, symbol) {
  if (n.mechanic !== 'roll') return { error: 'no roll pending' };
  if (symbol !== n.roll.symbol) return { error: `it is ${n.roll.symbol}'s roll` };

  const die = 1 + Math.floor(rand(state) * 20);
  const bonus = n.roll.bonus ?? 0;
  const total = die + bonus;
  const success = total >= n.roll.target;

  state.log.push({ kind: 'roll', by: symbol, die, bonus, total, target: n.roll.target, success });
  state.log.push({ kind: 'result', text: success ? n.roll.successText : n.roll.failText });
  return advance(state, success ? n.roll.success : n.roll.fail);
}

// --- mechanic 3: personal moment (free text) ------------------------------

function onMoment(state, n, move, symbol) {
  if (n.mechanic !== 'moment') return { error: 'no personal moment pending' };
  if (symbol !== n.symbol) return { error: `this moment belongs to ${n.symbol}` };

  const text = String(move.text ?? '').trim();
  if (!text) return { error: 'say or do something' };
  if (text.length > 140) return { error: 'max 140 characters' };

  const opt = n.options[classify(text, n.options)];
  state.log.push({ kind: 'moment', by: symbol, text });
  state.log.push({ kind: 'result', text: `Das läuft auf „${opt.label}“ hinaus.` });
  return advance(state, opt.next);
}

/**
 * Map free text onto one of the node's predefined options — pure keyword
 * matching (the no-AI classifier). An AI classifier can pre-map in the UI
 * later; the tree can never be broken either way.
 */
function classify(text, options) {
  const t = text.toLowerCase();
  let best = 0, bestScore = 0;
  options.forEach((o, i) => {
    const score = (o.keywords ?? []).filter(k => t.includes(k.toLowerCase())).length;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;   // no match → first option (deterministic fallback)
}

// --- node transition ------------------------------------------------------

function advance(state, nextId) {
  state.votes = {};
  state.nodeId = nextId;
  state.sceneNo += 1;

  const n = node(state);
  if (n.ending) {
    state.phase = 'ended';
    state.ending = { ...n.ending };
    state.log.push({ kind: 'ending', title: n.ending.title, text: n.text });
    return { state, end: { winner: 'draw', ending: state.ending } };   // co-op
  }
  state.log.push({ kind: 'scene', scene: state.sceneNo, text: n.text });
  return { state, end: null };
}

export { init, applyMove, classify };
