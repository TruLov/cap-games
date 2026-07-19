/**
 * KaffeeKwestService implementation — the plugin's own CAP app.
 * Sibling impl of srv/service.cds (loaded by CAP's default convention).
 *
 * Owns the async edges of a round so the gameplay loop stays pure:
 *  - scenario library (seeded from db/data/*.json, maintainable via OData)
 *  - player profiles + chronicles (persistent, per user, across rooms)
 *  - prepare(): casting + frozen decision tree -> settings JSON for `configure`
 *  - chronicle extraction + player-confirmed persistence (veto by omission)
 *
 * AI port seam: prepare() and suggestChronicle() call the static adapters
 * from ../lib/ai-static.js. An AI Core adapter with the same signatures can be
 * selected here later via cds.requires['kaffee-kwest'].ai — the static
 * adapters remain the fallback, so a round never breaks.
 */
import cds from '@sap/cds';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { treeBuilder, chronicler } from '../lib/ai-static.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = cds.log('kaffee-kwest');
const MAX_ACTIVE = 7;   // chronicle cap — oldest entries retire beyond this

export default class KaffeeKwestService extends cds.ApplicationService {
  async init() {
    const { Scenarios, Profiles, ChronicleEntries } = cds.entities('kk');

    cds.once('served', () =>
      this._seedScenarios(Scenarios).catch(e => LOG.error('scenario seeding failed:', e)));

    // ---------------------------------------------------------- MyChronicle
    this.on('READ', 'MyChronicle', req =>
      SELECT.from(ChronicleEntries)
        .where({ user: req.user.id, active: true })
        .orderBy('createdAt'));

    // -------------------------------------------------------------- profile
    this.on('myProfile', async req =>
      (await SELECT.one.from(Profiles).where({ user: req.user.id }))?.archetype ?? '');

    this.on('saveProfile', async req => {
      await UPSERT.into(Profiles).entries({
        user: req.user.id,
        archetype: String(req.data.archetype ?? '').slice(0, 255),
      });
    });

    // -------------------------------------------------------------- prepare
    this.on('prepare', async req => {
      const { scenario: id, party: partyJson } = req.data;
      const row = await SELECT.one.from(Scenarios).where({ ID: id });
      if (!row) return req.error(404, `unknown scenario: ${id}`);

      let party;
      try { party = JSON.parse(partyJson); } catch { return req.error(400, 'party must be JSON'); }
      if (!Array.isArray(party) || party.length < 2)
        return req.error(400, 'need at least 2 players');

      const users = party.map(p => p.user);
      const profiles = Object.fromEntries(
        (await SELECT.from(Profiles).where({ user: { in: users } }))
          .map(p => [p.user, p.archetype]));
      const chronicles = {};
      for (const e of await SELECT.from(ChronicleEntries)
        .where({ user: { in: users }, active: true }).orderBy('createdAt'))
        (chronicles[e.user] ??= []).push(e.text);

      const scenario = { ...row, roles: JSON.parse(row.roles), tree: JSON.parse(row.tree) };
      const settings = treeBuilder({ scenario, party, profiles, chronicles });
      LOG.info('PREPARE', id, 'party=' + party.map(p => `${p.symbol}:${p.user}`).join(','));
      return JSON.stringify(settings);
    });

    // ------------------------------------------------------------ chronicle
    this.on('suggestChronicle', async req => {
      let finalState;
      try { finalState = JSON.parse(req.data.finalState); } catch { return req.error(400, 'finalState must be JSON'); }
      return chronicler(finalState, req.user.id);
    });

    this.on('saveChronicle', async req => {
      const { entries = [], scenario = '' } = req.data;
      const texts = entries
        .map(t => String(t).trim())
        .filter(t => t && t.length <= 500)
        .slice(0, 2);   // concept: max 2 per round

      if (texts.length)
        await INSERT.into(ChronicleEntries).entries(
          texts.map(text => ({ user: req.user.id, text, scenario })));

      const active = await SELECT.from(ChronicleEntries)
        .where({ user: req.user.id, active: true })
        .orderBy('createdAt desc');
      for (const old of active.slice(MAX_ACTIVE))
        await UPDATE(ChronicleEntries, old.ID).with({ active: false });

      LOG.info('CHRONICLE', req.user.id, `+${texts.length}`);
      return texts.length;
    });

    await super.init();
  }

  /** Idempotent upsert of the bundled scenario files. */
  /** Insert-if-missing, so admin edits via OData survive restarts. */
  async _seedScenarios(Scenarios) {
    const dir = join(__dirname, '..', 'db', 'data');
    for (const f of (await readdir(dir)).filter(f => f.endsWith('.json'))) {
      const s = JSON.parse(await readFile(join(dir, f), 'utf8'));
      const exists = await SELECT.one.from(Scenarios).columns('ID').where({ ID: s.ID });
      if (exists) continue;
      await INSERT.into(Scenarios).entries({
        ...s,
        roles: JSON.stringify(s.roles),
        tree: JSON.stringify(s.tree),
      });
      LOG.info('seeded scenario:', s.ID);
    }
  }
}
