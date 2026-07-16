/**
 * shell/host.js — Platform Host Controls component
 *
 * Usage in game UI:
 *   import { mountHostControls } from '/shell/host.js';
 *   mountHostControls(containerEl, sdk, initialStatus);
 */

export function mountHostControls(el, sdk, initialStatus = 'lobby') {
  let status = initialStatus;

  function render() {
    if (!sdk.me.isHost) { el.innerHTML = ''; return; }
    const buttons = {
      lobby:    `<button id="sh-btn-start">Start game</button>`,
      finished: `<button id="sh-btn-rematch">Rematch</button>
                 <button id="sh-btn-backlobby">Back to lobby</button>`,
    };
    el.innerHTML = `<div class="sh-host-controls">${buttons[status] ?? ''}</div>`;

    el.querySelector('#sh-btn-start')?.addEventListener('click',
      () => sdk.send('start', { room: sdk.room.id }));
    el.querySelector('#sh-btn-rematch')?.addEventListener('click',
      () => sdk.send('rematch', { room: sdk.room.id }));
    el.querySelector('#sh-btn-backlobby')?.addEventListener('click',
      () => sdk.send('backToLobby', { room: sdk.room.id }));
  }

  function onStarted()     { status = 'playing';  render(); }
  function onFinished()    { status = 'finished'; render(); }
  function onRematched()   { status = 'playing';  render(); }
  function onLobbyReset()  { status = 'lobby';    render(); }

  sdk.on('started',    onStarted);
  sdk.on('finished',   onFinished);
  sdk.on('rematched',  onRematched);
  sdk.on('lobbyReset', onLobbyReset);

  render();

  return () => {
    sdk.off('started',    onStarted);
    sdk.off('finished',   onFinished);
    sdk.off('rematched',  onRematched);
    sdk.off('lobbyReset', onLobbyReset);
  };
}
