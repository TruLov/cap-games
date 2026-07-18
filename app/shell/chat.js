/**
 * shell/chat.js — Platform Chat component
 *
 * Usage in game UI:
 *   import { mountChat } from '/shell/chat.js';
 *   mountChat(containerEl, sdk);   // sdk provides send + on/off
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
      const name = document.createElement('strong');
      name.textContent = player + ':';
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
