

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
      expect(eng.guardStatus('finished', 'backToLobby')).to.equal(undefined);
      expect(eng.guardStatus('playing',  'backToLobby')).to.equal(undefined);
      expect(eng.guardStatus('paused',   'backToLobby')).to.equal(undefined);
    });

    it('rejects forbidden transitions', () => {
      expect(eng.guardStatus('lobby',    'move'   )).to.be.ok;
      expect(eng.guardStatus('playing',  'start'  )).to.be.ok;
      expect(eng.guardStatus('playing',  'rematch')).to.be.ok;
      expect(eng.guardStatus('finished', 'move'   )).to.be.ok;
      expect(eng.guardStatus('lobby',    'rematch')).to.be.ok;
    });

  });

  describe('defaultScore', () => {

    it('winner gets win/3, loser gets loss/0', () => {
      const scores = eng.defaultScore({ winner: 'X' }, [{ user: 'a', symbol: 'X' }, { user: 'b', symbol: 'O' }]);
      expect(scores.find(s => s.user === 'a')).to.deep.equal({ user: 'a', result: 'win',  points: 3 });
      expect(scores.find(s => s.user === 'b')).to.deep.equal({ user: 'b', result: 'loss', points: 0 });
    });

    it('draw gives draw/1 to all', () => {
      const scores = eng.defaultScore({ winner: 'draw' }, [{ user: 'a', symbol: 'X' }, { user: 'b', symbol: 'O' }]);
      expect(scores.every(s => s.result === 'draw' && s.points === 1)).to.be.true;
    });

    it('spectators are excluded', () => {
      const scores = eng.defaultScore({ winner: 'X' }, [{ user: 'a', symbol: 'X' }, { user: 's', symbol: 'spectator' }]);
      expect(scores).to.have.length(1);
      expect(scores[0].user).to.equal('a');
    });

  });

});
