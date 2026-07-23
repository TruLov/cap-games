/**
 * Static (no-AI) adapters for the two AI ports — pure functions, no CAP.
 *
 *   treeBuilder({ scenario, party, profiles, chronicles, seed? })
 *     -> settings JSON for `configure` (casting + frozen tree)
 *   chronicler(finalState, user)
 *     -> 0–2 suggested chronicle entries
 *
 * These make the game fully playable without any model call ("weak/no AI"
 * local development). An AI Core adapter can implement the same signatures
 * (big model: structured casting + tree; big model: chronicle extraction)
 * and gets selected in KaffeeKwestService via cds.requires['kaffee-kwest'].ai.
 */

const norm = s => (s ?? '').toLowerCase();

/** Everything we know about a player, as searchable lowercase text. */
export function playerText(user, profiles, chronicles) {
  return norm(`${profiles[user] ?? ''} ${(chronicles[user] ?? []).join(' ')}`);
}

/**
 * Casts each player onto a role from the scenario's role pool — pure game
 * logic (no AI), shared between the static and AI-Core treeBuilder adapters:
 *  - chronicle/archetype keywords win, join order breaks ties (round-robin)
 *
 * Players are keyed by their `user` id (the platform assigns no symbols).
 *
 * @param {Array} roles [{ role, hook, tags }] — scenario.roles
 * @param {Array} party [{ user, isHost }]
 * @param {object} texts { [user]: lowercase searchable player text }
 * @returns {object} casting { [user]: { role, hook, tags } }
 */
export function castParty(roles, party, texts) {
  const pool = roles.map(r => ({ ...r, taken: false }));
  const casting = {};

  // pass 1: keyword-matched roles
  for (const p of party) {
    let best = -1, bestScore = 0;
    pool.forEach((r, i) => {
      if (r.taken) return;
      const score = r.tags.filter(t => texts[p.user].includes(norm(t))).length;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (best >= 0) { pool[best].taken = true; casting[p.user] = pool[best]; }
  }
  // pass 2: everyone else gets the next free role (cycling for parties > pool)
  let next = 0;
  for (const p of party) {
    if (casting[p.user]) continue;
    while (pool[next % pool.length].taken && next < pool.length) next++;
    const r = pool[next % pool.length];
    r.taken = true; next++;
    casting[p.user] = r;
  }
  for (const s of Object.keys(casting))
    casting[s] = { role: casting[s].role, hook: casting[s].hook, tags: casting[s].tags };

  return casting;
}

/**
 * Resolves actors + roll bonuses into a copy of a scenario tree — pure game
 * logic (no AI), shared between the static and AI-Core treeBuilder adapters:
 *  - roll/moment nodes get their actor resolved from `castHint` tags
 *  - roll bonuses (±2) are derived from chronicle keywords — fixed at
 *    prepare time, exactly as the concept demands of the big model
 *
 * @param {object} scenarioTree { start, nodes } — engine-format tree (from
 *   an authored scenario.tree or from ai-aicore.js's toEngineFormat())
 * @param {Array}  party   [{ user, isHost }]
 * @param {object} casting { [user]: { role, hook, tags } }
 * @param {object} texts   { [user]: lowercase searchable player text }
 * @returns {object} resolved tree (deep clone, safe to mutate). Actor tokens
 *   written onto the tree (n.symbol / n.roll.symbol) are user ids.
 */
export function resolveTree(scenarioTree, party, casting, texts) {
  const resolved = structuredClone(scenarioTree);
  let rotation = 0;
  const actorFor = hint => {
    const match = party.find(p =>
      casting[p.user].tags?.some(t => norm(t) === norm(hint)) ||
      texts[p.user].includes(norm(hint)));
    return (match ?? party[rotation++ % party.length]).user;
  };

  for (const n of Object.values(resolved.nodes)) {
    if (n.mechanic === 'roll') {
      const sym = actorFor(n.roll.castHint ?? '');
      let bonus = 0;
      if (n.roll.bonusTag && texts[sym].includes(norm(n.roll.bonusTag))) bonus += 2;
      if (n.roll.malusTag && texts[sym].includes(norm(n.roll.malusTag))) bonus -= 2;
      n.roll.symbol = sym;
      n.roll.bonus = bonus;
    }
    if (n.mechanic === 'moment') {
      n.symbol = actorFor(n.castHint ?? '');
    }
  }

  return resolved;
}

/**
 * Casting + tree resolution:
 *  - each player gets a role from the scenario pool — chronicle/archetype
 *    keywords win, join order breaks ties (round-robin fallback)
 *  - roll/moment nodes get their actor resolved from `castHint` tags
 *  - roll bonuses (±2) are derived from chronicle keywords — fixed at
 *    prepare time, exactly as the concept demands of the big model
 */
export function treeBuilder({ scenario, party, profiles = {}, chronicles = {}, seed }) {
  const texts = Object.fromEntries(party.map(p => [p.user, playerText(p.user, profiles, chronicles)]));
  const casting = castParty(scenario.roles, party, texts);
  const resolved = resolveTree(scenario.tree, party, casting, texts);

  return {
    scenario: scenario.ID,
    title: scenario.title,
    party,
    casting,
    tree: resolved,
    sceneTotal: scenario.length ?? 5,
    ...(seed != null && { seed }),      // tests only — live rounds reseed per init
  };
}

/**
 * Heuristic chronicle extraction from the final public state's log:
 * natural 20/1 and personal moments are "prägend"; max 2, scenario-neutral.
 */
export function chronicler(finalState, user) {
  const me = finalState.party?.find(p => p.user === user);
  if (!me) return [];
  const role = finalState.casting?.[user]?.role ?? 'Abenteurer:in';
  const mine = (finalState.log ?? []).filter(e => e.by === user);

  const out = [];
  for (const e of mine) {
    if (e.kind === 'roll' && e.die === 20)
      out.push(`Hat als ${role} einen perfekten Moment erwischt (gilt seitdem als vom Glück geküsst)`);
    else if (e.kind === 'roll' && e.die === 1)
      out.push(`Hat einen legendären Fehlschlag überlebt (und erzählt die Geschichte heute etwas anders)`);
    else if (e.kind === 'moment')
      out.push(`Hat in einer brenzligen Lage gehandelt statt gezögert: „${e.text}“`);
  }
  if (out.length === 0) {
    const clutch = mine.find(e => e.kind === 'roll' && e.success && e.target >= 12);
    if (clutch) out.push(`Hat geliefert, als es darauf ankam (bestand eine schwere Probe als ${role})`);
  }
  return out.slice(0, 2);
}
