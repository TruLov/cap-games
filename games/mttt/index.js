/**
 * Ultimate Tic-Tac-Toe — a 3x3 grid of tic-tac-toe boards. Winning an inner
 * board claims that cell on the outer board; the cell you play in dictates
 * which inner board your opponent must play next (or, if that board is
 * already decided, they're free to play anywhere).
 *
 * Design and rules ported from https://github.com/mschleeweiss/mttt by
 * mschleeweiss (Marc) — used with his permission. His version is a full
 * NestJS + Socket.io + Vue app; this is a from-scratch reimplementation of
 * the board/win-condition/team-turn/blitz-timer rules in this platform's
 * pure-function style (see AGENTS.md's Game Interface Contract), sharing no
 * code with the original. Thanks, Marc!
 *
 * Game interface (cap-games platform):
 *   meta, init(settings, players), applyMove(state, move, user), score,
 *   extendService(srv) — registers `chooseTeam`/`configureBlitz`, this
 *   platform's first game extension of PlayService's WS protocol (see
 *   srv/extend.cds). Team picking is self-service (each player joins X or O
 *   themselves, pre-start) because the platform's only other pre-start
 *   write, `configure`, is host-only in code; blitz config IS host-only,
 *   but still goes through its own action rather than `configure` because
 *   `configure` blindly overwrites Rooms.settings, which would clobber
 *   whatever teams were already picked.
 *
 * Board layout: 81 flat cells, index = outerBoard*9 + innerCell (both 0-8,
 * row-major 3x3). `boardWinners[outerBoard]` is 'X'|'O'|'draw'|null.
 *
 * `init`/`applyMove`/`score` are pure, per the platform's game contract —
 * no CAP imports. `extendService` is the documented exception (it needs DB
 * access for the pre-start picks), same as srv/play-service.js. The blitz
 * timer additionally uses `getBoard` (handed in as extendService's second
 * arg — engine.js lives outside every `@cap-games/*` package, so a relative
 * import would break once this package is packed for deploy) to mutate the
 * shared board-state reference in place — a deliberate, first-of-its-kind
 * exception (no other game reaches into engine.js): a real, server-enforced
 * per-move timeout has no way around touching the same board-state source
 * of truth a real move does, and no part of the documented game contract
 * exposes that otherwise.
 */

import cds from '@sap/cds';

const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

const MIN_BLITZ_SECONDS = 5;
const MAX_BLITZ_SECONDS = 120;
const DEFAULT_BLITZ_SECONDS = 30;

const isMark = v => v === 'X' || v === 'O';

// `cells` is either 9 raw marks, or (for the outer board) 9 inner-board
// winners — which can include 'draw'. A 'draw' never counts toward a line:
// three drawn boards in a row must NOT end the game early.
function checkWinner(cells) {
  const line = WIN_LINES.find(
    l => isMark(cells[l[0]]) && cells[l[0]] === cells[l[1]] && cells[l[1]] === cells[l[2]]
  );
  return line ? cells[line[0]] : null;
}

// Whose turn: team alternates every move (regardless of team size), and
// within a team, turns cycle through its members by move count — ported
// directly from the original's determineCurrentPlayer().
function currentTurn(teams, moveCount) {
  const mark = moveCount % 2 === 0 ? 'X' : 'O';
  const team = teams[mark];
  if (!team.length) return null;
  const idx = Math.floor(moveCount / 2) % team.length;
  return team[idx];
}

function markOf(teams, user) {
  if (teams.X.includes(user)) return 'X';
  if (teams.O.includes(user)) return 'O';
  return null;
}

function resolveBlitz(settings) {
  const raw = settings.blitz ?? {};
  return {
    enabled: !!raw.enabled,
    seconds: Number.isInteger(raw.seconds)
      ? Math.min(MAX_BLITZ_SECONDS, Math.max(MIN_BLITZ_SECONDS, raw.seconds))
      : DEFAULT_BLITZ_SECONDS,
  };
}

export default {

  meta: {
    name:       'Ultimate Tic-Tac-Toe',
    minPlayers: 2,
    maxPlayers: 8,
  },

  init(settings = {}, players = []) {
    // Teams come from pre-start `chooseTeam` picks (persisted in room
    // settings — see extendService below). Any player who never picked
    // (or a stale/removed pick) is auto-balanced onto the smaller team, so
    // `start` never silently drops a player.
    const teams = {
      X: [...(settings.teams?.X ?? [])],
      O: [...(settings.teams?.O ?? [])],
    };
    for (const { user } of players) {
      if (teams.X.includes(user) || teams.O.includes(user)) continue;
      (teams.X.length <= teams.O.length ? teams.X : teams.O).push(user);
    }
    // Drop anyone who picked a team but isn't an active room member anymore.
    const active = new Set(players.map(p => p.user));
    teams.X = teams.X.filter(u => active.has(u));
    teams.O = teams.O.filter(u => active.has(u));

    return {
      cells:        Array(81).fill(null),
      boardWinners: Array(9).fill(null),
      winner:       null,
      activeBoard:  null,   // null = any open board is playable
      teams,
      moveCount:    0,
      turn:         currentTurn(teams, 0),
      blitz:        resolveBlitz(settings), // { enabled, seconds } — fixed for the whole match
    };
  },

  applyMove(state, move, user) {
    const { cells, boardWinners, teams, moveCount, activeBoard, blitz } = state;
    const { cell } = move;

    if (user !== state.turn)
      return { error: 'not your turn' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 80)
      return { error: 'invalid cell' };

    const board = Math.floor(cell / 9);
    if (activeBoard != null && board !== activeBoard)
      return { error: 'must play in the active board' };
    if (boardWinners[board] != null)
      return { error: 'that board is already decided' };
    if (cells[cell] != null)
      return { error: 'cell taken' };

    const mark = markOf(teams, user);
    const newCells = [...cells];
    newCells[cell] = mark;

    const newBoardWinners = [...boardWinners];
    const boardCells = newCells.slice(board * 9, board * 9 + 9);
    const boardWinMark = checkWinner(boardCells);
    if (boardWinMark) newBoardWinners[board] = boardWinMark;
    else if (boardCells.every(Boolean)) newBoardWinners[board] = 'draw';

    const outerWinMark = checkWinner(newBoardWinners);
    const outerFull = newBoardWinners.every(Boolean);
    const winner = outerWinMark ?? (outerFull ? 'draw' : null);

    const nextBoard = cell % 9;
    const newActiveBoard = newBoardWinners[nextBoard] != null ? null : nextBoard;
    const newMoveCount = moveCount + 1;

    const newState = {
      cells: newCells,
      boardWinners: newBoardWinners,
      winner,
      activeBoard: winner ? activeBoard : newActiveBoard,
      teams,
      moveCount: newMoveCount,
      turn: winner ? state.turn : currentTurn(teams, newMoveCount),
      blitz,
    };

    return {
      state: newState,
      end: winner ? { winner, teams } : null,
    };
  },

  // defaultScore only supports a single winning `user` — a team win needs
  // every teammate scored, so this game supplies its own.
  score(end, players) {
    const { winner, teams } = end;
    return players
      .filter(p => !p.spectator)
      .map(p => {
        const onWinningTeam = winner !== 'draw' && teams[winner]?.includes(p.user);
        return {
          user: p.user,
          result: winner === 'draw' ? 'draw' : (onWinningTeam ? 'win' : 'loss'),
          points: winner === 'draw' ? 1 : (onWinningTeam ? 3 : 0),
        };
      });
  },

  // Self-service team picking + host-only blitz config, pre-start, plus the
  // blitz per-move timer itself (see srv/extend.cds for the WS actions/
  // event this registers handlers for).
  extendService(srv, { getBoard }) {
    const { Rooms, Players } = cds.entities('cap.games');

    const loadSettings = async (roomId) => {
      const room = await SELECT.one.from(Rooms, roomId).columns('settings');
      return room?.settings ? JSON.parse(room.settings) : {};
    };

    const broadcastSettings = async (roomId, settings) => {
      const teams = { X: settings.teams?.X ?? [], O: settings.teams?.O ?? [] };
      const blitz = resolveBlitz(settings);
      await srv.emit('settingsChanged', {
        room: roomId, teams: JSON.stringify(teams),
        blitzEnabled: blitz.enabled, blitzSeconds: blitz.seconds,
      });
    };

    // CDS-native `req.error(...)` only delivers via an ack callback — this
    // platform's client (`sdk.send`/`wsSend`) never registers one, so it
    // would silently swallow every validation error. The platform's own
    // handlers surface errors via a `gameError` broadcast instead
    // (srv/play-service.js's `_error`); mirrored here for the same reason.
    const gameError = (roomId, message) => srv.emit('gameError', { room: roomId, message });

    srv.on('chooseTeam', async (req) => {
      const { room: roomId, team } = req.data;
      const user = req.user.id;
      if (!['X', 'O', 'none'].includes(team))
        return gameError(roomId, `Invalid team: ${team}`);

      const room = await SELECT.one.from(Rooms, roomId).columns('status', 'settings');
      if (!room) return gameError(roomId, 'room not found');
      if (room.status !== 'lobby') return gameError(roomId, 'teams are locked once the match starts');

      const player = await SELECT.one.from(Players).where({ room_ID: roomId, user });
      if (!player || player.spectator) return gameError(roomId, 'spectators cannot join a team');

      const settings = room.settings ? JSON.parse(room.settings) : {};
      const teams = { X: settings.teams?.X ?? [], O: settings.teams?.O ?? [] };
      teams.X = teams.X.filter(u => u !== user);
      teams.O = teams.O.filter(u => u !== user);
      if (team !== 'none') teams[team].push(user);

      const newSettings = { ...settings, teams };
      await UPDATE(Rooms, roomId).with({ settings: JSON.stringify(newSettings) });
      await broadcastSettings(roomId, newSettings);
    });

    srv.on('configureBlitz', async (req) => {
      const { room: roomId, enabled, seconds } = req.data;
      const user = req.user.id;
      if (typeof enabled !== 'boolean') return gameError(roomId, 'enabled must be a boolean');
      if (!Number.isInteger(seconds) || seconds < MIN_BLITZ_SECONDS || seconds > MAX_BLITZ_SECONDS)
        return gameError(roomId, `seconds must be between ${MIN_BLITZ_SECONDS} and ${MAX_BLITZ_SECONDS}`);

      const room = await SELECT.one.from(Rooms, roomId).columns('status', 'host', 'settings');
      if (!room) return gameError(roomId, 'room not found');
      if (room.host !== user) return gameError(roomId, 'host only');
      if (room.status !== 'lobby') return gameError(roomId, 'blitz settings are locked once the match starts');

      const settings = room.settings ? JSON.parse(room.settings) : {};
      const newSettings = { ...settings, blitz: { enabled, seconds } };
      await UPDATE(Rooms, roomId).with({ settings: JSON.stringify(newSettings) });
      await broadcastSettings(roomId, newSettings);
    });

    srv.on('requestSettings', async (req) => {
      const settings = await loadSettings(req.data.room);
      await broadcastSettings(req.data.room, settings);
    });

    // ---- blitz per-move timer ----------------------------------------
    // roomId -> Node timer handle. Module-scoped like srv/engine.js's own
    // graceTimers/boardState maps.
    const turnTimers = new Map();

    const clearTurnTimer = (roomId) => {
      clearTimeout(turnTimers.get(roomId));
      turnTimers.delete(roomId);
    };
    const armTurnTimer = (roomId, seconds) => {
      clearTurnTimer(roomId);
      turnTimers.set(roomId, setTimeout(() => onTimeout(roomId), seconds * 1000));
    };

    // Re-evaluate the timer for a room whenever its board progresses
    // (started/moved/rematched) — reused by real moves AND by onTimeout's
    // own skip, which re-broadcasts via the same 'moved' event, so a single
    // hook naturally re-arms the timer for whoever's turn it is next.
    const onProgress = (roomId) => {
      const b = getBoard(roomId);
      if (!b || b.game !== 'mttt') return; // this hook fires for EVERY game's events
      clearTurnTimer(roomId);
      if (b.state.winner || !b.state.blitz?.enabled) return;
      armTurnTimer(roomId, b.state.blitz.seconds);
    };

    async function onTimeout(roomId) {
      turnTimers.delete(roomId); // this handle already fired
      const b = getBoard(roomId);
      if (!b || b.game !== 'mttt' || b.state.winner || !b.state.blitz?.enabled) return;

      const room = await SELECT.one.from(Rooms, roomId).columns('status');
      if (!room || room.status !== 'playing') return; // paused/finished/reset since arming

      const timedOutUser = b.state.turn;
      const newMoveCount = b.state.moveCount + 1;
      const newState = { ...b.state, moveCount: newMoveCount, turn: currentTurn(b.state.teams, newMoveCount) };
      b.state = newState;
      b.turn = newState.turn;

      await srv._broadcastState(roomId, 'mttt', b, 'moved', {});
      await srv._sysMsg(roomId, `${timedOutUser} timed out — turn skipped.`);
      // no explicit re-arm here: the 'moved' broadcast above runs through
      // onProgress() below just like a real move would.
    }

    srv.on('started',   (req) => onProgress(req.data.room));
    srv.on('moved',     (req) => onProgress(req.data.room));
    srv.on('rematched', (req) => onProgress(req.data.room));
    srv.on('finished',   (req) => clearTurnTimer(req.data.room));
    srv.on('roomReset',  (req) => clearTurnTimer(req.data.room));
    srv.on('gameSwitched', (req) => clearTurnTimer(req.data.room));

    // Disconnect tolerance, consistent with the platform's own grace-timer
    // philosophy: don't let a dropped connection burn the mover's clock.
    srv.on('playerDisconnected', (req) => {
      const b = getBoard(req.data.room);
      if (b?.game === 'mttt' && b.state.turn === req.data.player) clearTurnTimer(req.data.room);
    });
    srv.on('playerReconnected', (req) => {
      const b = getBoard(req.data.room);
      if (b?.game === 'mttt' && b.state.turn === req.data.player && !b.state.winner && b.state.blitz?.enabled)
        armTurnTimer(req.data.room, b.state.blitz.seconds);
    });
  },
};
