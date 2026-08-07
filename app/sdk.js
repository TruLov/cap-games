/**
 * sdk.js — Platform SDK factory
 *
 * Shell calls makeSdk({ room, me, players, wsSend, emitter, toastFn, leaveFn,
 * nameOf, avatarUrl }) once per room session. Game receives sdk via
 * mount(rootEl, sdk) — called only once a match is actually starting/active
 * — and uses it freely.
 *
 * sdk = {
 *   room     { id, game }
 *   me       { user, spectator, isHost }
 *   players  live roster array [{ user, spectator, isHost }] — the platform
 *            keeps this current for the room's whole lifetime (joins, leaves,
 *            kicks, role changes, game switches); games read it directly
 *            instead of tracking their own copy.
 *   send(action, data)      — send any WS action to PlayService
 *   on(event, fn)           — subscribe to any server event
 *   off(event, fn)          — unsubscribe
 *   toast(msg)              — show brief status in shell header
 *   leave()                 — leave room (shell handles routing)
 *   nameOf(user)            — gamertag for a user id, falling back to the id
 *                             itself if none is set; resolved via the
 *                             platform's profile cache (never fetch this
 *                             yourself — a game never talks to ProfileService
 *                             directly, only through sdk)
 *   avatarUrl(user)         — avatar image URL for a user id, or null if
 *                             they haven't set one (render your own fallback,
 *                             e.g. initials, in that case)
 *   chat                    — chat hook: the platform owns the transport (and,
 *                             later, history); a game that renders its own chat
 *                             UI (meta.ownsChat = true) drives it through here
 *                             instead of the platform's default chat panel.
 *                             .send(text) / .onMessage(fn) / .offMessage(fn),
 *                             fn receives { room, player, text, ts }.
 *   loadFont(css)           — inject a document-level <style> (e.g. @font-face).
 *                             A game's own styles live in its shadow root, but
 *                             @font-face is ignored inside a shadow root, so
 *                             fonts must be registered on the document. Use an
 *                             absolute URL: new URL('../x.ttf', import.meta.url).
 * }
 */

const loadedFonts = new Set();   // dedupe loadFont across mounts/rooms in a session

export function makeSdk({ room, me, players, wsSend, emitter, toastFn, leaveFn, nameOf, avatarUrl }) {
  return {
    room,
    me,
    players,
    send(action, data) { wsSend(action, data); },
    on(event, fn)      { emitter.on(event, fn); },
    off(event, fn)     { emitter.off(event, fn); },
    toast(msg)         { toastFn(msg); },
    leave()            { leaveFn(); },
    nameOf(user)       { return nameOf ? nameOf(user) : user; },
    avatarUrl(user)    { return avatarUrl ? avatarUrl(user) : null; },
    chat: {
      send(text)     { wsSend('chat', { room: room.id, text }); },
      onMessage(fn)  { emitter.on('chatMessage', fn); },
      offMessage(fn) { emitter.off('chatMessage', fn); },
    },
    loadFont(css) {
      if (loadedFonts.has(css)) return;
      loadedFonts.add(css);
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    },
  };
}

/**
 * Simple event emitter — distributes WS server events to
 * game + shell components without tight coupling.
 */
export function makeEmitter() {
  const handlers = {};
  return {
    on(event, fn) {
      (handlers[event] ??= new Set()).add(fn);
    },
    off(event, fn) {
      handlers[event]?.delete(fn);
    },
    emit(event, data) {
      handlers[event]?.forEach(fn => fn(data));
    },
  };
}
