/**
 * shell/players.js — Platform Players component
 *
 * Usage in game UI:
 *   import { mountPlayers } from '/shell/players.js';
 *   mountPlayers(containerEl, sdk, initialPlayers);
 */

import { initials } from '/shell/util.js';

export function mountPlayers(el, sdk, initialPlayers = []) {
  const players = [...initialPlayers];

  function render() {
    el.innerHTML = `<ul class="sh-players">
      ${players.map(p => `
        <li class="sh-player${p.user === sdk.me.user ? ' me' : ''}${p.spectator ? ' sh-spectator' : ''}">
          <span class="sh-sym">${initials(p.user)}</span>
          <span class="sh-name">${p.user}${p.user === sdk.me.user ? ' (you)' : ''}${p.spectator ? ' — spectator' : ''}</span>
          ${sdk.me.isHost && p.user !== sdk.me.user
            ? `<button class="sh-role sh-small" data-user="${p.user}" data-spectator="${!p.spectator}">${p.spectator ? '→ player' : '→ spectator'}</button>
               <button class="sh-kick sh-small danger" data-user="${p.user}">kick</button>`
            : ''}
        </li>`).join('')}
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

  sdk.on('joined',       onJoined);
  sdk.on('playerLeft',   onLeft);
  sdk.on('playerKicked', onKicked);
  sdk.on('roleChanged',  onRoleChanged);

  render();

  return () => {
    sdk.off('joined',       onJoined);
    sdk.off('playerLeft',   onLeft);
    sdk.off('playerKicked', onKicked);
    sdk.off('roleChanged',  onRoleChanged);
  };
}
