/**
 * shell/chat.js - Platform Chat component
 *
 * Mounted once by platform.js for the room's whole session (never by a game
 * directly) - lives in the persistent room chrome, so it's never torn down
 * across a switchGame/start/finish/rematch cycle.
 */

export function mountChat(el, sdk) {
  el.innerHTML = `
    <div class="sh-chat">
      <div class="sh-chat-messages" id="sh-chat-msgs"></div>
      <div class="sh-chat-input">
        <input id="sh-chat-text" placeholder="Chat…" />
        <button id="sh-chat-send">Send</button>
      </div>
    </div>
  `;

  const msgs  = el.querySelector('#sh-chat-msgs');
  const input = el.querySelector('#sh-chat-text');
  const btn   = el.querySelector('#sh-chat-send');

  function onMessage({ player, text }) {
    const row = document.createElement('div');
    row.className = player === 'system' ? 'sh-chat-msg sh-chat-sys' : 'sh-chat-msg';
    if (player === 'system') {
      row.textContent = text;
    } else {
      // Best-effort: labels with whatever's cached at message-receipt time.
      // Not retroactively relabeled if the sender's profile resolves later
      // (chat is append-only DOM, not a re-rendered list like the players
      // panel) - in practice the profile is already cached by the time
      // anyone can chat (loaded whenever the roster is).
      const name = document.createElement('strong');
      name.textContent = sdk.nameOf(player) + ':';
      row.appendChild(name);
      row.appendChild(document.createTextNode(' ' + text));
    }
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function send() {
    const t = input.value.trim();
    if (!t) return;
    sdk.send('chat', { room: sdk.room.id, text: t });
    input.value = '';
  }

  btn.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };

  sdk.on('chatMessage', onMessage);

  // return cleanup fn so game can unmount if needed
  return () => sdk.off('chatMessage', onMessage);
}
