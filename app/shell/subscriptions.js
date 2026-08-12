/**
 * subscribeMany(emitter, pairs) - subscribe every [event, handler] pair at
 * once and return a single unsubscribe function.
 *
 * Small, generic primitive shared by the shell components that each mount a
 * fixed set of listeners together and must tear them all down together
 * (room-session.js's roster/lifecycle set, players.js's roster deltas):
 * spelling the pair list once instead of twice (on.../off...) keeps the two
 * lists from drifting out of sync.
 */
export function subscribeMany(emitter, pairs) {
  pairs.forEach(([ev, fn]) => emitter.on(ev, fn));
  return () => pairs.forEach(([ev, fn]) => emitter.off(ev, fn));
}
