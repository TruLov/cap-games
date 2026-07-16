/**
 * shell/players.js — Platform Players component
 *
 * Usage in game UI:
 *   import { mountPlayers } from '/shell/players.js';
 *   mountPlayers(containerEl, sdk, initialPlayers);
 */

export function mountPlayers(el, sdk, initialPlayers = []) {
  const players = [...initialPlayers];

  function render() {
    el.innerHTML = `<ul class="sh-players">
      ${players.map(p => `
        <li class="sh-player${p.user === sdk.me.user ? ' me' : ''}">
          <span class="sh-sym">${p.symbol}</span>
          <span class="sh-name">${p.user}${p.user === sdk.me.user ? ' (you)' : ''}</span>
          ${sdk.me.isHost && p.user !== sdk.me.user
            ? `<button class="sh-kick small danger" data-user="${p.user}">kick</button>`
            : ''}
        </li>`).join('')}
    </ul>`;

    el.querySelectorAll('.sh-kick').forEach(b =>
      b.onclick = () => sdk.send('kick', { room: sdk.room.id, user: b.dataset.user }));
  }

  function onJoined({ player, symbol }) {
    if (!players.find(p => p.user === player))
      players.push({ user: player, symbol });
    render();
  }

  function onLeft({ player }) {
    const i = players.findIndex(p => p.user === player);
    if (i >= 0) players.splice(i, 1);
    render();
  }

  function onKicked({ player }) { onLeft({ player }); }

  sdk.on('joined',       onJoined);
  sdk.on('playerLeft',   onLeft);
  sdk.on('playerKicked', onKicked);

  render();

  return () => {
    sdk.off('joined',       onJoined);
    sdk.off('playerLeft',   onLeft);
    sdk.off('playerKicked', onKicked);
  };
}
