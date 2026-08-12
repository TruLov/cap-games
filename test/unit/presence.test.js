

import cds from '@sap/cds';
const { expect } = cds.test;
import { describe, it } from 'node:test';
import * as presence from '../../srv/presence.js';

describe('presence', () => {

  describe('isPending / pendingUsers', () => {

    it('reflects a running grace clock, independent of any board', () => {
      const roomId = 'room-no-board';
      expect(presence.isPending(roomId, 'alice')).to.be.false;

      presence.disconnect(roomId, 'alice', { onDrop: () => {}, onAnnounce: () => {} });
      expect(presence.isPending(roomId, 'alice')).to.be.true;
      expect(presence.pendingUsers(roomId)).to.deep.equal(['alice']);

      presence.leave(roomId, 'alice');
      expect(presence.isPending(roomId, 'alice')).to.be.false;
      expect(presence.pendingUsers(roomId)).to.deep.equal([]);
    });

    it('leave on an unknown room/user is a no-op', () => {
      expect(() => presence.leave('nope', 'nobody')).not.to.throw();
    });

  });

  describe('reconnect debounce (hides refresh churn)', () => {

    it('reconnecting before the announce clock fires resolves silent, and suppresses both callbacks', async () => {
      const roomId = 'room-quick-refresh';
      let dropped = false, announced = false;

      presence.disconnect(roomId, 'alice', {
        onDrop:     () => { dropped = true; },
        onAnnounce: () => { announced = true; },
        graceMs: 50, announceMs: 10,
      });

      // Reconnect immediately - well before either clock fires.
      expect(presence.reconnect(roomId, 'alice')).to.equal('silent');
      expect(presence.isPending(roomId, 'alice')).to.be.false;

      // Both clocks were cancelled - neither callback ever runs.
      await new Promise(r => setTimeout(r, 60));
      expect(dropped).to.be.false;
      expect(announced).to.be.false;
    });

    it('reconnecting after the announce clock already fired resolves announce', async () => {
      const roomId = 'room-real-drop';
      let announced = false;

      presence.disconnect(roomId, 'bob', {
        onDrop:     () => {},
        onAnnounce: () => { announced = true; },
        graceMs: 200, announceMs: 10,
      });

      // Wait past the announce window (but well before grace expires).
      await new Promise(r => setTimeout(r, 25));
      expect(announced).to.be.true;

      // The grace clock is still running - this is a genuine reconnect, not a
      // timeout - and the announce already went out, so the reconnect itself
      // must be announced too.
      expect(presence.reconnect(roomId, 'bob')).to.equal('announce');
      expect(presence.isPending(roomId, 'bob')).to.be.false;
    });

  });

});
