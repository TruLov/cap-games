/**
 * sdk.js — Platform SDK factory
 *
 * Shell calls makeSdk(room, me, wsSend, wsOnce) once per game session.
 * Game receives sdk via mount(rootEl, sdk) and uses it freely.
 *
 * sdk = {
 *   room   { id, game }
 *   me     { user, symbol, isHost }
 *   send(action, data)      — send any WS action to PlayService
 *   on(event, fn)           — subscribe to any server event
 *   off(event, fn)          — unsubscribe
 *   toast(msg)              — show brief status in shell header
 *   leave()                 — leave room (shell handles routing)
 * }
 */

export function makeSdk({ room, me, wsSend, emitter, toastFn, leaveFn }) {
  return {
    room,
    me,
    send(action, data) { wsSend(action, data); },
    on(event, fn)      { emitter.on(event, fn); },
    off(event, fn)     { emitter.off(event, fn); },
    toast(msg)         { toastFn(msg); },
    leave()            { leaveFn(); },
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
    clear() {
      Object.keys(handlers).forEach(k => delete handlers[k]);
    },
  };
}
