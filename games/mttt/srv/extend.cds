using { PlayService } from '../../../srv/play-service';

// Self-service team picking + host-only blitz (per-move timer) config, both
// pre-start. `configure` (the platform's only other pre-start settings-write
// action) is host-only in code AND does a blind overwrite of Rooms.settings
// — unsuitable for self-service team picks (every player picks for
// themselves, not just the host) and risky to mix with anything else
// writing the same JSON blob. So both settings here go through their own
// actions, each doing a merge-safe read-modify-write. Room-scoped like the
// platform's own events.
extend service PlayService with {
  action chooseTeam(room: String, team: String);              // team: 'X' | 'O' | 'none'
  action configureBlitz(room: String, enabled: Boolean, seconds: Integer); // host only
  // The platform's WS actions here are fire-and-forget (no return-value
  // channel the frontend actually reads — see AGENTS.md sdk contract);
  // clients learn state only from broadcast events. A client mounting the
  // waiting room needs the CURRENT settings, not just future changes, so it
  // asks for a fresh broadcast on mount.
  action requestSettings(room: String);
  event settingsChanged { @ws.context room: String; teams: LargeString; blitzEnabled: Boolean; blitzSeconds: Integer; }
}
