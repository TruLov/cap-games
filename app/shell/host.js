/**
 * shell/host.js - Platform Waiting-Room controls
 *
 * Rendered by platform.js (never by a game directly) while a room's status is
 * 'lobby' - i.e. before a game module is ever mounted. Players + chat live in
 * the persistent room chrome (platform.js), so this component only owns:
 *   - the host's switch-game control + Start control (plain generic button,
 *     unless the game defines its own `renderSettings`, in which case that
 *     panel takes over the Start trigger itself - e.g. to send `configure`
 *     first, sometimes asynchronously)
 *   - calling the optional `game.renderSettings(el, sdk)` hook for EVERYONE
 *     (not just the host) - some games have per-player pre-start setup; the
 *     game decides internally what a non-host sees there (or nothing at all)
 *   - the plain "waiting for host" message when a game has no settings panel
 *     at all and you're not the host
 *
 * Torn down the instant the match actually starts - see platform.js.
 */

export async function mountWaitingRoom(el, sdk, gameModule) {
  const noGame      = !gameModule;                                    // empty room
  const hasSettings = typeof gameModule?.renderSettings === 'function';

  // Game selection lives in the library cards now (see platform.js
  // handleGameCard) - the rail waiting panel only owns Start + the game's own
  // settings + the appropriate "waiting" message.
  let controls;
  if (sdk.me.isHost) {
    if (noGame)          controls = '<p class="sh-small">Pick a game from the library to set up your room.</p>';
    else if (!hasSettings) controls = '<button id="sh-btn-start" class="sh-rr-start">Start game</button>';
    else                 controls = '';   // the game's settings panel supplies its own Start
  } else {
    controls = !hasSettings ? '<p class="sh-small">Waiting for the host…</p>' : '';
  }

  el.innerHTML = `${controls}<div id="sh-settings-slot"></div>`;
  el.querySelector('#sh-btn-start')?.addEventListener('click',
    () => sdk.send('start', { room: sdk.room.id }));

  // Render the game's settings panel inside a shadow root, for the same style
  // isolation as the game board - a game-owned surface that shouldn't inherit
  // the platform theme. Rendered for everyone (some games have per-player setup).
  let settingsCleanup = null;
  if (hasSettings && !noGame) {
    const slot = el.querySelector('#sh-settings-slot');
    const sroot = document.createElement('div');
    slot.attachShadow({ mode: 'open' }).appendChild(sroot);
    settingsCleanup = gameModule.renderSettings(sroot, sdk) ?? null;
  }

  return () => { settingsCleanup?.(); };
}
