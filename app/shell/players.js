/**
 * shell/players.js - Platform Players component
 *
 * Mounted once by platform.js for the room's whole session (never by a game
 * directly) - lives in the persistent room chrome alongside chat, so it's
 * never torn down across a switchGame/start/finish/rematch cycle.
 */

import { initials } from '/shell/util.js';
import { subscribeMany } from './subscriptions.js';

export function mountPlayers(el, sdk, initialPlayers = []) {
  const players = [...initialPlayers];

  function render() {
    el.innerHTML = `<ul class="sh-players">
      ${players.map(p => {
        const name  = sdk.nameOf(p.user);
        const avUrl = sdk.avatarUrl(p.user);
        return `
        <li class="sh-player${p.user === sdk.me.user ? ' me' : ''}${p.spectator ? ' sh-spectator' : ''}">
          <span class="sh-sym">${avUrl ? `<img src="${avUrl}" alt="">` : initials(name)}</span>
          <span class="sh-name">${name}${p.user === sdk.me.user ? ' (you)' : ''}${p.spectator ? ' - spectator' : ''}</span>
          ${sdk.me.isHost && p.user !== sdk.me.user
            ? `<button class="sh-role sh-small" data-user="${p.user}" data-spectator="${!p.spectator}">${p.spectator ? '→ player' : '→ spectator'}</button>
               <button class="sh-kick sh-small danger" data-user="${p.user}">kick</button>`
            : ''}
        </li>`;
      }).join('')}
    </ul>`;

    el.querySelectorAll('.sh-kick').forEach(b =>
      b.onclick = () => sdk.send('kick', { room: sdk.room.id, user: b.dataset.user }));
    el.querySelectorAll('.sh-role').forEach(b =>
      b.onclick = () => sdk.send('setRole', {
        room: sdk.room.id, user: b.dataset.user, spectator: b.dataset.spectator === 'true',
      }));
  }

  function onJoined({ player, spectator }) {
    if (!players.find(p => p.user === player))
      players.push({ user: player, spectator });
    render();
  }

  function onLeft({ player }) {
    const i = players.findIndex(p => p.user === player);
    if (i >= 0) players.splice(i, 1);
    render();
  }

  function onKicked({ player }) { onLeft({ player }); }

  function onRoleChanged({ player, spectator }) {
    const p = players.find(p => p.user === player);
    if (p) p.spectator = spectator;
    render();
  }

  // Full authoritative resync - sent by the server on join/reconnect and on
  // switchGame. Replaces the local list wholesale (belt-and-braces alongside
  // the incremental joined/playerLeft/playerKicked/roleChanged deltas above).
  function onRoster({ players: json }) {
    let list;
    try { list = JSON.parse(json); } catch { return; }
    players.length = 0;
    players.push(...list);
    render();
  }

  const unsubscribe = subscribeMany(sdk, [
    ['joined',          onJoined],
    ['playerLeft',      onLeft],
    ['playerKicked',    onKicked],
    ['roleChanged',     onRoleChanged],
    ['roster',          onRoster],
    ['profilesUpdated', render], // gamertag/avatar can resolve after initial render
  ]);

  render();

  return unsubscribe;
}
