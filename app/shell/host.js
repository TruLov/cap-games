/**
 * shell/host.js — Platform Host Controls component
 *
 * Usage in game UI:
 *   import { mountHostControls } from '/shell/host.js';
 *   mountHostControls(containerEl, sdk, initialStatus);
 */

export function mountHostControls(el, sdk, initialStatus = 'lobby') {
  let status = initialStatus;
  let games  = null; // lazy-loaded catalogue for the switch-game dropdown

  async function loadGames() {
    if (games) return games;
    try {
      const res = await fetch('/odata/v4/lobby/Games');
      const data = await res.json();
      games = data.value ?? [];
    } catch { games = []; }
    return games;
  }

  async function render() {
    if (!sdk.me.isHost) { el.innerHTML = ''; return; }
    const buttons = {
      lobby:    `<button id="sh-btn-start">Start game</button>`,
      finished: `<button id="sh-btn-rematch">Rematch</button>
                 <button id="sh-btn-backroom">Back to room</button>`,
    };
    let switchHtml = '';
    if (status === 'lobby') {
      const list = await loadGames();
      switchHtml = `
        <div class="sh-row sh-switch-game">
          <select id="sh-switch-select">
            ${list.map(g => `<option value="${g.id}" ${g.id === sdk.room.game ? 'selected' : ''}>${g.name}</option>`).join('')}
          </select>
          <button id="sh-btn-switch" class="sh-small">Switch game</button>
        </div>`;
    }
    el.innerHTML = `<div class="sh-host-controls">${buttons[status] ?? ''}${switchHtml}</div>`;

    el.querySelector('#sh-btn-start')?.addEventListener('click',
      () => sdk.send('start', { room: sdk.room.id }));
    el.querySelector('#sh-btn-rematch')?.addEventListener('click',
      () => sdk.send('rematch', { room: sdk.room.id }));
    el.querySelector('#sh-btn-backroom')?.addEventListener('click',
      () => sdk.send('backToRoom', { room: sdk.room.id }));
    el.querySelector('#sh-btn-switch')?.addEventListener('click', () => {
      const game = el.querySelector('#sh-switch-select').value;
      if (game && game !== sdk.room.game) sdk.send('switchGame', { room: sdk.room.id, game });
    });
  }

  function onStarted()     { status = 'playing';  render(); }
  function onFinished()    { status = 'finished'; render(); }
  function onRematched()   { status = 'playing';  render(); }
  function onRoomReset()   { status = 'lobby';    render(); }
  function onGameSwitched({ game }) { sdk.room.game = game; render(); }

  sdk.on('started',      onStarted);
  sdk.on('finished',     onFinished);
  sdk.on('rematched',    onRematched);
  sdk.on('roomReset',    onRoomReset);
  sdk.on('gameSwitched', onGameSwitched);

  render();

  return () => {
    sdk.off('started',      onStarted);
    sdk.off('finished',     onFinished);
    sdk.off('rematched',    onRematched);
    sdk.off('roomReset',    onRoomReset);
    sdk.off('gameSwitched', onGameSwitched);
  };
}
