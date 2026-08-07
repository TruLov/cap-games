/**
 * shell/host.js — Platform Waiting-Room controls
 *
 * Rendered by platform.js (never by a game directly) while a room's status is
 * 'lobby' — i.e. before a game module is ever mounted. Players + chat live in
 * the persistent room chrome (platform.js), so this component only owns:
 *   - the host's switch-game control + Start control (plain generic button,
 *     unless the game defines its own `renderSettings`, in which case that
 *     panel takes over the Start trigger itself — e.g. to send `configure`
 *     first, sometimes asynchronously)
 *   - calling the optional `game.renderSettings(el, sdk)` hook for EVERYONE
 *     (not just the host) — some games have per-player pre-start setup; the
 *     game decides internally what a non-host sees there (or nothing at all)
 *   - the plain "waiting for host" message when a game has no settings panel
 *     at all and you're not the host
 *
 * Torn down the instant the match actually starts — see platform.js.
 */

export async function mountWaitingRoom(el, sdk, gameModule) {
  const hasSettings = typeof gameModule.renderSettings === 'function';

  let hostControls = '';
  if (sdk.me.isHost) {
    let games = [];
    try {
      const res = await fetch('/odata/v4/lobby/Games');
      games = (await res.json()).value ?? [];
    } catch { /* leave games empty — switch control just shows nothing to pick */ }

    hostControls = `
      <div class="sh-host-controls">
        <div class="sh-row sh-switch-game">
          <select id="sh-switch-select">
            ${games.map(g => `<option value="${g.id}" ${g.id === sdk.room.game ? 'selected' : ''}>${g.name}</option>`).join('')}
          </select>
          <button id="sh-btn-switch" class="sh-small">Switch game</button>
        </div>
        ${hasSettings ? '' : '<button id="sh-btn-start">Start game</button>'}
      </div>`;
  }

  el.innerHTML = `
    ${hostControls}
    <div id="sh-settings-slot"></div>
    ${!sdk.me.isHost && !hasSettings ? '<p class="sh-small">Waiting for the host to start…</p>' : ''}
  `;

  el.querySelector('#sh-btn-switch')?.addEventListener('click', () => {
    const game = el.querySelector('#sh-switch-select').value;
    if (game && game !== sdk.room.game) sdk.send('switchGame', { room: sdk.room.id, game });
  });
  el.querySelector('#sh-btn-start')?.addEventListener('click',
    () => sdk.send('start', { room: sdk.room.id }));

  // Render the game's settings panel inside a shadow root too, for the same
  // style isolation as the game board (mountGame) — the panel is a game-owned
  // surface that shouldn't inherit the platform's button/heading theme.
  let settingsCleanup = null;
  if (hasSettings) {
    const slot = el.querySelector('#sh-settings-slot');
    const sroot = document.createElement('div');
    slot.attachShadow({ mode: 'open' }).appendChild(sroot);
    settingsCleanup = gameModule.renderSettings(sroot, sdk) ?? null;
  }

  return () => { settingsCleanup?.(); };
}
