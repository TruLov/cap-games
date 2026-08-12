

import cds from '@sap/cds';
const { expect } = cds.test;
import { describe, it } from 'node:test';
import * as eng from '../../srv/engine.js';

describe('engine', () => {

  describe('guardStatus', () => {

    it('allows valid transitions', () => {
      expect(eng.guardStatus('lobby',    'configure'  )).to.equal(undefined);
      expect(eng.guardStatus('lobby',    'start'      )).to.equal(undefined);
      expect(eng.guardStatus('playing',  'move'       )).to.equal(undefined);
      expect(eng.guardStatus('finished', 'rematch'    )).to.equal(undefined);
      expect(eng.guardStatus('finished', 'backToRoom')).to.equal(undefined);
      expect(eng.guardStatus('playing',  'backToRoom')).to.equal(undefined);
      expect(eng.guardStatus('paused',   'backToRoom')).to.equal(undefined);
    });

    it('rejects forbidden transitions', () => {
      expect(eng.guardStatus('lobby',    'move'   )).to.be.ok;
      expect(eng.guardStatus('playing',  'start'  )).to.be.ok;
      expect(eng.guardStatus('playing',  'rematch')).to.be.ok;
      expect(eng.guardStatus('finished', 'move'   )).to.be.ok;
      expect(eng.guardStatus('lobby',    'rematch')).to.be.ok;
    });

    it('switchGame/setRole only allowed while lobby', () => {
      expect(eng.guardStatus('lobby',    'switchGame')).to.equal(undefined);
      expect(eng.guardStatus('lobby',    'setRole'   )).to.equal(undefined);
      expect(eng.guardStatus('playing',  'switchGame')).to.be.ok;
      expect(eng.guardStatus('finished', 'setRole'   )).to.be.ok;
    });

  });

  describe('grace timers (independent of board state)', () => {

    it('can be set/checked/cleared for a room with no board (e.g. lobby status)', () => {
      const roomId = 'room-no-board';
      expect(eng.getBoard(roomId)).to.equal(undefined);   // no board exists
      expect(eng.hasGraceTimer(roomId, 'alice')).to.be.false;

      eng.setGraceTimer(roomId, 'alice', () => {});
      expect(eng.hasGraceTimer(roomId, 'alice')).to.be.true;
      expect(eng.allGraceTimers(roomId)).to.deep.equal(['alice']);

      eng.clearGraceTimer(roomId, 'alice');
      expect(eng.hasGraceTimer(roomId, 'alice')).to.be.false;
      expect(eng.allGraceTimers(roomId)).to.deep.equal([]);
    });

    it('clearGraceTimer on an unknown room/user is a no-op', () => {
      expect(() => eng.clearGraceTimer('nope', 'nobody')).not.to.throw();
    });

  });

  describe('announce-timer debounce (hides refresh churn)', () => {

    it('clearAnnounceTimer returns true while pending, false once fired', async () => {
      const roomId = 'room-announce';
      let fired = false;

      // Short delay so the test can observe the timer firing.
      eng.setAnnounceTimer(roomId, 'alice', () => { fired = true; }, 10);

      // Cleared before it fires → still pending → true, and callback suppressed.
      expect(eng.clearAnnounceTimer(roomId, 'alice')).to.be.true;
      await new Promise(r => setTimeout(r, 25));
      expect(fired).to.be.false;

      // Let a second one fire, then clearing reports it already went out.
      eng.setAnnounceTimer(roomId, 'bob', () => { fired = true; }, 10);
      await new Promise(r => setTimeout(r, 25));
      expect(fired).to.be.true;
      expect(eng.clearAnnounceTimer(roomId, 'bob')).to.be.false;   // already fired
    });

    it('clearAnnounceTimer on an unknown room/user returns false', () => {
      expect(eng.clearAnnounceTimer('nope', 'nobody')).to.equal(false);
    });

  });

  describe('defaultScore', () => {

    it('winner gets win/3, loser gets loss/0', () => {
      const scores = eng.defaultScore({ winner: 'a' }, [{ user: 'a', spectator: false }, { user: 'b', spectator: false }]);
      expect(scores.find(s => s.user === 'a')).to.deep.equal({ user: 'a', result: 'win',  points: 3 });
      expect(scores.find(s => s.user === 'b')).to.deep.equal({ user: 'b', result: 'loss', points: 0 });
    });

    it('draw gives draw/1 to all', () => {
      const scores = eng.defaultScore({ winner: 'draw' }, [{ user: 'a', spectator: false }, { user: 'b', spectator: false }]);
      expect(scores.every(s => s.result === 'draw' && s.points === 1)).to.be.true;
    });

    it('spectators are excluded', () => {
      const scores = eng.defaultScore({ winner: 'a' }, [{ user: 'a', spectator: false }, { user: 's', spectator: true }]);
      expect(scores).to.have.length(1);
      expect(scores[0].user).to.equal('a');
    });

  });

});
