/**
 * Integration tests — KaffeeKwestService OData layer.
 *
 * Boots the full CAP server (cds.test), then exercises the service via HTTP
 * so the CAP middleware stack, entity access and chronicle-cap logic are all
 * covered — these are the parts with zero unit-test coverage.
 *
 * Covered:
 *  - scenario seeding: both bundled JSONs land in the DB on startup
 *  - Scenarios read (unauthenticated → 401, authenticated → list)
 *  - myProfile / saveProfile round-trip
 *  - prepare: valid call returns settings JSON; bad inputs are rejected
 *  - saveChronicle: persists entries, enforces the 7-active cap (oldest retired)
 *  - suggestChronicle: returns an array (static adapter smoke test)
 */

import cds from '@sap/cds';
import { describe, it, before } from 'node:test';

const cdst = cds.test('.'); // must be first
const { expect } = cdst;

const basic = (u) => 'Basic ' + Buffer.from(`${u}:${u}`).toString('base64');

let url;
before(async () => {
  ({ url } = await cdst);
});

const kk = (path, user, opts = {}) =>
  fetch(`${url}/odata/v4/kaffee-kwest${path}`, {
    headers: {
      'content-type': 'application/json',
      ...(user ? { authorization: basic(user) } : {}),
    },
    ...opts,
  });

// OData function (GET)
const fn = (name, user) => kk(`/${name}()`, user);

// OData action (POST)
const act = (action, body, user) =>
  kk(`/${action}`, user, { method: 'POST', body: JSON.stringify(body) });

// --------------------------------------------------------------------------

describe('KaffeeKwestService', () => {

  describe('scenario seeding', () => {
    it('both bundled scenarios are in the DB after startup', async () => {
      const res = await kk('/Scenarios', 'alice');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      const ids = value.map(s => s.ID);
      expect(ids).to.include('nebelmine');
      expect(ids).to.include('zeitkapsel');
    });

    it('scenario titles are correct', async () => {
      const res = await kk('/Scenarios', 'alice');
      const { value } = await res.json();
      const byId = Object.fromEntries(value.map(s => [s.ID, s]));
      expect(byId.nebelmine.title).to.equal('Der Fluch der Nebelmine');
      expect(byId.zeitkapsel.title).to.equal('Die Zeitkapsel des Praktikanten');
    });

    it('unauthenticated request is rejected', async () => {
      const res = await kk('/Scenarios', null);
      expect(res.status).to.equal(401);
    });
  });

  // -------------------------------------------------------------------------

  describe('myProfile / saveProfile', () => {
    it('fresh user has empty profile', async () => {
      const res = await fn('myProfile', 'profile_alice');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      expect(value).to.equal('');
    });

    it('saveProfile persists and myProfile returns it', async () => {
      const sr = await act('saveProfile', { archetype: 'neugierig, redet sich gern raus' }, 'profile_bob');
      expect(sr.status).to.equal(204);
      const res = await fn('myProfile', 'profile_bob');
      const { value } = await res.json();
      expect(value).to.equal('neugierig, redet sich gern raus');
    });

    it('saveProfile is idempotent (upsert)', async () => {
      await act('saveProfile', { archetype: 'erste Version' }, 'profile_carol');
      await act('saveProfile', { archetype: 'zweite Version' }, 'profile_carol');
      const res = await fn('myProfile', 'profile_carol');
      const { value } = await res.json();
      expect(value).to.equal('zweite Version');
    });
  });

  // -------------------------------------------------------------------------

  describe('prepare', () => {
    const party = JSON.stringify([
      { symbol: 'X', user: 'prep_alice', isHost: true },
      { symbol: 'O', user: 'prep_bob' },
    ]);

    it('returns valid settings JSON for a known scenario', async () => {
      const res = await act('prepare', { scenario: 'nebelmine', party }, 'prep_alice');
      expect(res.status).to.equal(200);
      const body = await res.json();
      const settings = JSON.parse(body.value);
      // settings must have everything init() needs
      expect(settings.casting).to.be.ok;
      expect(settings.tree).to.be.ok;
      expect(settings.tree.start).to.equal('eingang');
      expect(typeof settings.sceneTotal).to.equal('number');
      expect(settings.casting.X).to.be.ok;
      expect(settings.casting.O).to.be.ok;
    });

    it('second bundled scenario also prepares successfully', async () => {
      const res = await act('prepare', { scenario: 'zeitkapsel', party }, 'prep_alice');
      expect(res.status).to.equal(200);
      const body = await res.json();
      const settings = JSON.parse(body.value);
      expect(settings.tree.start).to.equal('fund');
    });

    it('rejects unknown scenario with 404', async () => {
      const res = await act('prepare', { scenario: 'does-not-exist', party }, 'prep_alice');
      expect(res.status).to.equal(404);
    });

    it('rejects malformed party JSON with 400', async () => {
      const res = await act('prepare', { scenario: 'nebelmine', party: 'not-json' }, 'prep_alice');
      expect(res.status).to.equal(400);
    });

    it('rejects party with fewer than 2 players with 400', async () => {
      const small = JSON.stringify([{ symbol: 'X', user: 'only_one', isHost: true }]);
      const res = await act('prepare', { scenario: 'nebelmine', party: small }, 'prep_alice');
      expect(res.status).to.equal(400);
    });
  });

  // -------------------------------------------------------------------------

  describe('saveChronicle', () => {
    it('persists confirmed entries and returns count', async () => {
      const res = await act('saveChronicle',
        { entries: ['Hat einen Drachen mit Kaffee besänftigt'], scenario: 'nebelmine' },
        'chron_alice');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      expect(value).to.equal(1);
    });

    it('MyChronicle reflects saved entries', async () => {
      const res = await kk('/MyChronicle', 'chron_alice');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      expect(value.some(e => e.text.includes('Drachen'))).to.equal(true);
    });

    it('enforces 7-active cap: oldest entry is retired when cap is exceeded', async () => {
      const user = 'chron_bob';
      // insert 8 entries one by one so order is deterministic
      const texts = Array.from({ length: 8 }, (_, i) => `Chronik-Eintrag Nummer ${i + 1}`);
      for (const t of texts)
        await act('saveChronicle', { entries: [t], scenario: 'nebelmine' }, user);

      const res = await kk('/MyChronicle', user);
      const { value } = await res.json();
      const active = value.filter(e => e.active !== false);
      expect(active.length).to.equal(7);
      // oldest (Nummer 1) must be gone from active entries
      expect(active.some(e => e.text === 'Chronik-Eintrag Nummer 1')).to.equal(false);
    });

    it('ignores empty entries array gracefully', async () => {
      const res = await act('saveChronicle', { entries: [], scenario: 'nebelmine' }, 'chron_carol');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      expect(value).to.equal(0);
    });

    it('silently discards entries longer than 500 chars', async () => {
      const long = 'x'.repeat(501);
      const res = await act('saveChronicle', { entries: [long, 'kurz'], scenario: 'nebelmine' }, 'chron_dave');
      const { value } = await res.json();
      expect(value).to.equal(1); // only the short one
    });
  });

  // -------------------------------------------------------------------------

  describe('suggestChronicle', () => {
    it('returns an array (static adapter smoke test)', async () => {
      const finalState = JSON.stringify({
        party: [
          { symbol: 'X', user: 'sug_alice', isHost: true },
          { symbol: 'O', user: 'sug_bob' },
        ],
        casting: {
          X: { role: 'Schmied:in mit Vorschlaghammer' },
          O: { role: 'Kräuterkundige:r' },
        },
        log: [
          { kind: 'roll', by: 'X', die: 20, bonus: 0, total: 20, target: 12, success: true },
          { kind: 'moment', by: 'X', text: 'Ich biete dir meinen Hammer!' },
        ],
      });
      const res = await act('suggestChronicle', { finalState }, 'sug_alice');
      expect(res.status).to.equal(200);
      const { value } = await res.json();
      expect(Array.isArray(value)).to.equal(true);
    });
  });

});
