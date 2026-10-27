import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTE, TIMINGS, type ChatMessage, type RoomSettings, type RoomState } from '@dws/shared';
import { GameError } from '../src/utils/errors.js';
import { createRoomHarness, P1, P2, P3, P4 } from './helpers.js';

const chunk = (id: string, color = '#000000', final = true) => ({ id, tool: 'pen' as const, color, size: 6, points: [10, 10, 20, 20], final });

function expectGameError(fn: () => void, code: string, message?: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GameError);
    expect((err as GameError).code).toBe(code);
    if (message) expect((err as GameError).message).toMatch(message);
    return;
  }
  throw new Error(`Expected GameError ${code}`);
}

/** Private room with the given players already joined (P1 hosts). */
function room(settings: Partial<RoomSettings>, players = [P1, P2, P3]) {
  const h = createRoomHarness('private', { rounds: 1, drawTime: 60, ...settings });
  players.forEach((id, i) => h.room.join(id, `Player${i + 1}`));
  return h;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// ------------------------------------------------------------------ 1. Custom room rules
describe('Custom room rules', () => {
  it('lets only the host change rules, only in the lobby', () => {
    const h = room({});
    expectGameError(() => h.room.updateSettings(P2, { hints: false }), 'not-host');
    h.room.updateSettings(P1, { hints: false, lateJoin: false, reactions: false });
    expect(h.room.settings).toMatchObject({ hints: false, lateJoin: false, reactions: false });
    h.room.startGame(P1);
    expectGameError(() => h.room.updateSettings(P1, { rounds: 2 }), 'wrong-phase', /locked/);
  });

  it('rejects incompatible combinations with a clear message', () => {
    const h = room({});
    expectGameError(() => h.room.updateSettings(P1, { teams: true, collaborative: true }), 'bad-request', /cannot be combined/);
    expectGameError(() => h.room.updateSettings(P1, { mode: 'chaos', chaosRules: [] }), 'bad-request', /at least one Chaos/);
    expectGameError(() => h.room.updateSettings(P1, { teams: true, teamCount: 4, maxPlayers: 6 }), 'bad-request', /at least 8/);
    expectGameError(() => h.room.updateSettings(P1, { collaborative: true, artistSeconds: 60, drawTime: 60 }), 'bad-request', /shorter/);
    expectGameError(() => h.room.updateSettings(P1, { maxPlayers: 2 }), 'bad-request', /already 3 players/);
    expect(h.room.settings.teams).toBe(false); // nothing was applied
  });

  it('turns hints off', () => {
    const h = room({ hints: false }, [P1, P2]);
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 1); // "giraffe" would normally get hints
    vi.advanceTimersByTime(59_000);
    expect(h.room.toState().hint!.every((c) => c === null)).toBe(true);
  });

  it('can block late joining', () => {
    const h = room({ lateJoin: false }, [P1, P2]);
    h.room.join(P3, 'Early'); // lobby is fine
    h.room.startGame(P1);
    expectGameError(() => h.room.join(P4, 'Late'), 'game-in-progress');
    expect(h.room.canAccept(P4)).toBe(false);
    expect(h.room.join(P3, 'Early')).toBe('rejoined'); // members may still reconnect
  });
});

// ------------------------------------------------------------------ 2. Chaos Drawing mode
describe('Chaos Drawing mode', () => {
  function chaosTurn(rules: RoomSettings['chaosRules'], random = false) {
    const h = room({ mode: 'chaos', chaosRules: rules, chaosRandom: random }, [P1, P2]);
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    h.room.chooseWord(drawer, 0);
    return { ...h, drawer, guesser: drawer === P1 ? P2 : P1 };
  }

  it('publishes the active challenges for everyone to see', () => {
    const { room: r, sent } = chaosTurn(['flipped-canvas', 'shifting-brush']);
    const chaos = r.toState().chaos!;
    expect(chaos.rules).toEqual(['flipped-canvas', 'shifting-brush']);
    expect(['horizontal', 'vertical']).toContain(chaos.flip);
    expect(chaos.brushSeed).toEqual(expect.any(Number));
    expect(sent.some((e) => (e.payload as ChatMessage).text?.includes('Chaos challenges'))).toBe(true);
  });

  it('enforces the limited palette on the server', () => {
    const { room: r, drawer } = chaosTurn(['limited-palette']);
    const palette = r.toState().chaos!.palette!;
    expect(palette).toHaveLength(4);
    expect(palette).not.toContain('#ffffff');
    const banned = PALETTE.find((c) => !palette.includes(c) && c !== '#ffffff')!;
    expectGameError(() => r.drawChunk(drawer, chunk('stroke01', banned)), 'bad-request', /palette/);
    expectGameError(() => r.fill(drawer, { id: 'fill0001', color: banned, x: 1, y: 1 }), 'bad-request', /palette/);
    r.drawChunk(drawer, chunk('stroke02', palette[0]));
    r.drawChunk(drawer, { ...chunk('stroke03'), tool: 'eraser', color: banned }); // eraser always works
    expect(r.drawHistory()).toHaveLength(2);
  });

  it('allows exactly one stroke with no fill, undo or clear in the one-stroke challenge', () => {
    const { room: r, drawer } = chaosTurn(['one-stroke']);
    r.drawChunk(drawer, chunk('stroke01', '#000000', false));
    r.drawChunk(drawer, { ...chunk('stroke01'), points: [30, 30] }); // continuing is fine
    expectGameError(() => r.drawChunk(drawer, chunk('stroke02')), 'bad-request', /One stroke/);
    expectGameError(() => r.fill(drawer, { id: 'fill0001', color: '#000000', x: 1, y: 1 }), 'bad-request', /one-stroke/);
    expectGameError(() => r.undo(drawer), 'bad-request', /one-stroke/);
    expectGameError(() => r.clear(drawer), 'bad-request', /one-stroke/);
  });

  it('picks a random non-empty combination of the enabled challenges each turn', () => {
    const enabled: RoomSettings['chaosRules'] = ['invisible-ink', 'limited-palette', 'one-stroke'];
    const seen = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const { room: r } = chaosTurn(enabled, true);
      const rules = r.toState().chaos!.rules;
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.every((x) => enabled.includes(x))).toBe(true);
      seen.add(rules.join('+'));
      r.dispose();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('has no chaos in normal mode', () => {
    const h = room({}, [P1, P2]);
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    expect(h.room.toState().chaos).toBeNull();
  });
});

// ------------------------------------------------------------------ 3. One drawing, multiple artists
describe('Collaborative drawing', () => {
  function collab(players = [P1, P2, P3, P4]) {
    const h = room({ collaborative: true, artistCount: 2, artistSeconds: 15 }, players);
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    h.room.chooseWord(drawer, 0);
    const artists = [...h.room.currentArtists];
    const guessers = players.filter((p) => !artists.includes(p));
    return { ...h, artists, guessers };
  }

  it('gives the word to every artist but not to guessers, and only the pen holder may draw', () => {
    const { room: r, receivedBy, artists, guessers } = collab();
    expect(artists).toHaveLength(2);
    for (const a of artists) expect(receivedBy(a, 'turn:word')).toHaveLength(1);
    for (const g of guessers) expect(receivedBy(g, 'turn:word')).toHaveLength(0);
    const [first, second] = artists;
    expect(r.toState().currentArtistId).toBe(first);
    expectGameError(() => r.drawChunk(second!, chunk('stroke01')), 'not-drawer');
    expectGameError(() => r.drawChunk(guessers[0]!, chunk('stroke01')), 'not-drawer');
    r.drawChunk(first!, chunk('stroke01'));
  });

  it('passes the pen on a timer and keeps the canvas', () => {
    const { room: r, artists } = collab();
    r.drawChunk(artists[0]!, chunk('stroke01'));
    expect(r.toState().artistRemainingMs).toBe(15_000);
    vi.advanceTimersByTime(15_000);
    expect(r.toState().currentArtistId).toBe(artists[1]);
    expect(r.drawHistory().map((o) => o.id)).toEqual(['stroke01']);
    r.drawChunk(artists[1]!, chunk('stroke02'));
    vi.advanceTimersByTime(15_000);
    expect(r.toState().currentArtistId).toBe(artists[0]); // wraps around
    expect(r.drawHistory()).toHaveLength(2);
  });

  it('lets the pen holder pass early, but nobody else', () => {
    const { room: r, artists, guessers } = collab();
    expectGameError(() => r.passPen(artists[1]!), 'not-drawer');
    expectGameError(() => r.passPen(guessers[0]!), 'not-drawer');
    r.passPen(artists[0]!);
    expect(r.toState().currentArtistId).toBe(artists[1]);
  });

  it('skips a disconnected artist and ends the turn if all artists leave', () => {
    const { room: r, artists } = collab();
    r.markDisconnected(artists[0]!);
    expect(r.toState().currentArtistId).toBe(artists[1]);
    r.removePlayer(artists[1]!, 'left');
    r.removePlayer(artists[0]!, 'left');
    expect(r.phase).toBe('turnEnd');
    expect(r.toState().lastTurn!.reason).toBe('drawer-left');
  });

  it('rewards every artist when guessers get it, and always leaves at least one guesser', () => {
    const { room: r, artists, guessers } = collab();
    for (const g of guessers) r.handleChat(g, r.currentWord!);
    const scores = Object.fromEntries(r.toState().players.map((p) => [p.id, p.score]));
    for (const a of artists) expect(scores[a]).toBeGreaterThan(0);
    expect(r.phase).toBe('turnEnd');
    expect(r.toState().lastTurn!.artistIds).toEqual(artists);

    const small = collab([P1, P2]); // two players: one artist, one guesser
    expect(small.artists).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 4. Reactions and voting
describe('Live reactions', () => {
  it('broadcasts reactions while drawing and counts them', () => {
    const h = room({}, [P1, P2]);
    expectGameError(() => h.room.react(P2, '🔥'), 'wrong-phase');
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    h.room.react(P2, '🔥');
    h.room.react(P2, '😂');
    h.room.react(P1, '🔥');
    expect(h.sent.filter((e) => e.event === 'reaction')).toHaveLength(3);
    expect(h.room.toState().reactions).toEqual({ '🔥': 2, '😂': 1 });
    expectGameError(() => h.room.react(P2, '💩' as never), 'bad-request');
  });

  it('can be turned off by the host', () => {
    const h = room({ reactions: false }, [P1, P2]);
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    expectGameError(() => h.room.react(P2, '👏'), 'bad-request', /turned off/);
  });
});

describe('End-of-round voting', () => {
  /** Plays one full round (each player draws once, nobody guesses). */
  function playRound(settings: Partial<RoomSettings> = {}) {
    const h = room({ voting: true, voteBonus: 40, votingSeconds: 20, ...settings });
    h.room.startGame(P1);
    for (let t = 0; t < 3; t++) {
      h.room.chooseWord(h.room.currentDrawerId!, 0);
      vi.advanceTimersByTime(60_000 + TIMINGS.TURN_END_MS);
    }
    return h;
  }

  it('opens a vote after the round with one candidate per drawing', () => {
    const { room: r } = playRound();
    expect(r.phase).toBe('voting');
    const voting = r.toState().voting!;
    expect(voting.candidates).toHaveLength(3);
    expect(voting.categories).toEqual(['funniest', 'creative']);
  });

  it('rejects self-votes, duplicates and late votes', () => {
    const { room: r } = playRound();
    const candidates = r.toState().voting!.candidates;
    const own = candidates.find((c) => c.artistIds.includes(P1))!;
    const other = candidates.find((c) => !c.artistIds.includes(P1))!;
    expectGameError(() => r.castVote(P1, 'funniest', own.turnNumber), 'bad-request', /own drawing/);
    r.castVote(P1, 'funniest', other.turnNumber);
    expectGameError(() => r.castVote(P1, 'funniest', other.turnNumber), 'bad-request', /already voted/);
    expectGameError(() => r.castVote(P1, 'teamwork', other.turnNumber), 'bad-request', /not used/);
    expectGameError(() => r.castVote(P1, 'creative', 999), 'bad-request', /not part/);
    vi.advanceTimersByTime(20_000);
    expectGameError(() => r.castVote(P2, 'creative', other.turnNumber), 'wrong-phase', /closed/);
  });

  it('awards the host-configured bonus to winners and records votes received', () => {
    const { room: r, games } = playRound();
    const candidates = r.toState().voting!.candidates;
    const target = candidates.find((c) => c.artistIds[0] === P3)!;
    r.castVote(P1, 'funniest', target.turnNumber);
    r.castVote(P2, 'funniest', target.turnNumber);
    const before = r.toState().players.find((p) => p.id === P3)!.score;
    vi.advanceTimersByTime(20_000);
    const state = r.toState();
    expect(state.voting!.closed).toBe(true);
    expect(state.voting!.winners).toEqual([{ category: 'funniest', turnNumber: target.turnNumber, artistIds: [P3], votes: 2 }]);
    expect(state.players.find((p) => p.id === P3)!.score).toBe(before + 40);
    vi.advanceTimersByTime(TIMINGS.VOTE_REVEAL_MS);
    expect(r.phase).toBe('gameEnd'); // it was the last round
    expect(games[0]!.players.find((p) => p.playerId === P3)!.votesReceived).toBe(2);
  });

  it('closes early when everyone has voted, and offers "best teamwork" for collaborative rooms', () => {
    const h = room({ voting: true, collaborative: true, artistCount: 2, artistSeconds: 15 });
    h.room.startGame(P1);
    for (let t = 0; t < 3; t++) {
      h.room.chooseWord(h.room.currentDrawerId!, 0);
      vi.advanceTimersByTime(60_000 + TIMINGS.TURN_END_MS);
    }
    const voting = h.room.toState().voting!;
    expect(voting.categories).toContain('teamwork');
    for (const voter of [P1, P2, P3]) {
      for (const category of voting.categories) {
        const pick = voting.candidates.find((c) => !c.artistIds.includes(voter));
        if (pick) h.room.castVote(voter, category, pick.turnNumber);
      }
    }
    expect(h.room.toState().voting!.closed).toBe(true);
  });
});

// ------------------------------------------------------------------ 5. Team Battle
describe('Team Battle', () => {
  it('assigns teams automatically and keeps them balanced', () => {
    const h = room({ teams: true, teamCount: 2 }, [P1, P2, P3, P4]);
    const teams = h.room.toState().teams!;
    expect(teams.map((t) => t.memberIds.length)).toEqual([2, 2]);
    expectGameError(() => h.room.joinTeam(P1, 1), 'bad-request', /automatically/);
    h.room.removePlayer(P2, 'left');
    h.room.removePlayer(P4, 'left'); // could leave 2 v 0 → rebalanced
    const sizes = h.room.toState().teams!.map((t) => t.memberIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it('supports manual team selection with capacity limits and host balancing', () => {
    const h = room({ teams: true, teamCount: 2, teamAssignment: 'manual', maxPlayers: 4 }, [P1, P2, P3]);
    // Joining puts players on the smallest team first: P1→0, P2→1, P3→0. Capacity is 4/2 = 2.
    h.room.joinTeam(P3, 1);
    expect(h.room.toState().teams!.map((t) => t.memberIds.length)).toEqual([1, 2]);
    expectGameError(() => h.room.joinTeam(P1, 1), 'bad-request', /full/);
    expectGameError(() => h.room.joinTeam(P3, 5), 'bad-request');
    expectGameError(() => h.room.balanceTeams(P2), 'not-host');
    h.room.balanceTeams(P1);
    const sizes = h.room.toState().teams!.map((t) => t.memberIds.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('refuses to start while a team is empty', () => {
    const h = room({ teams: true, teamCount: 2, teamAssignment: 'manual' }, [P1, P2]);
    h.room.joinTeam(P1, 0);
    h.room.joinTeam(P2, 0);
    expectGameError(() => h.room.startGame(P1), 'bad-request', /no players/);
  });

  it('alternates drawers between teams, adds a team bonus and decides the winning team', () => {
    const h = room({ teams: true, teamCount: 2, teamBonus: 30 }, [P1, P2, P3, P4]);
    h.room.startGame(P1);
    const teamOf = (id: string) => h.room.toState().players.find((p) => p.id === id)!.team;
    const firstDrawer = h.room.currentDrawerId!;
    h.room.chooseWord(firstDrawer, 0);
    // Everyone on the drawer's opponent team guesses → that team gets the bonus.
    const opponents = [P1, P2, P3, P4].filter((p) => teamOf(p) !== teamOf(firstDrawer));
    for (const p of opponents) h.room.handleChat(p, h.room.currentWord!);
    const opponentTeam = teamOf(opponents[0]!)!;
    expect(h.room.toState().teams![opponentTeam]!.bonus).toBe(30);
    // The remaining teammate guesses too → turn ends; next drawer comes from the other team.
    for (const p of [P1, P2, P3, P4].filter((x) => x !== firstDrawer && !opponents.includes(x))) h.room.handleChat(p, h.room.currentWord!);
    vi.advanceTimersByTime(TIMINGS.TURN_END_MS);
    expect(teamOf(h.room.currentDrawerId!)).not.toBe(teamOf(firstDrawer));

    const teams = h.room.toState().teams!;
    const members = teams[opponentTeam]!.memberIds;
    const sum = h.room.toState().players.filter((p) => members.includes(p.id)).reduce((s, p) => s + p.score, 0);
    expect(teams[opponentTeam]!.score).toBe(sum + 30);

    for (let t = 0; t < 3; t++) {
      if (h.room.phase === 'choosing') h.room.chooseWord(h.room.currentDrawerId!, 0);
      vi.advanceTimersByTime(60_000 + TIMINGS.TURN_END_MS);
    }
    expect(h.room.phase).toBe('gameEnd');
    const summary = h.games[0]!;
    const winners = summary.players.filter((p) => p.teamWin);
    expect(winners.length).toBeGreaterThan(0);
    expect(new Set(winners.map((p) => p.team)).size).toBe(1);
  });

  it('can score teams by average so uneven teams are fair', () => {
    const h = room({ teams: true, teamCount: 2, teamScoring: 'average' }, [P1, P2, P3]);
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    for (const p of [P1, P2, P3]) if (p !== h.room.currentDrawerId) h.room.handleChat(p, h.room.currentWord!);
    const state = h.room.toState();
    for (const team of state.teams!) {
      const scores = state.players.filter((p) => team.memberIds.includes(p.id)).map((p) => p.score);
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      expect(team.score).toBe(avg + team.bonus);
    }
  });

  it('puts late joiners on the smallest team', () => {
    const h = room({ teams: true, teamCount: 2 }, [P1, P2, P3]);
    h.room.startGame(P1);
    h.room.join(P4, 'Late');
    const sizes = h.room.toState().teams!.map((t) => t.memberIds.length);
    expect(sizes).toEqual([2, 2]);
  });
});

// ------------------------------------------------------------------ 6. Language Battle
describe('Language Battle', () => {
  function tamilTurn() {
    const h = room({ language: 'ta' }, [P1, P2]);
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    h.room.chooseWord(drawer, 0);
    return { ...h, drawer, guesser: drawer === P1 ? P2 : P1 };
  }

  it('accepts curated alternative answers (transliteration, translation)', () => {
    const { room: r, guesser } = tamilTurn();
    expect(r.currentWord).toBe('யானை');
    expect(r.toState().wordLanguage).toBe('ta');
    r.handleChat(guesser, 'Elephant');
    expect(r.toState().players.find((p) => p.id === guesser)!.hasGuessed).toBe(true);
  });

  it('accepts the Tamil word itself, and hides artist messages that contain any answer', () => {
    const { room: r, drawer, guesser, sent } = tamilTurn();
    r.handleChat(drawer, 'clue: yaanai');
    const leaked = sent.filter((e) => e.event === 'chat:message' && (e.payload as ChatMessage).text.includes('yaanai'));
    expect(leaked.every((e) => e.to !== 'all' && !e.to.includes(guesser))).toBe(true);
    r.handleChat(guesser, 'யானை');
    expect(r.phase).toBe('turnEnd');
  });

  it('does not accept a different Tamil word', () => {
    const { room: r, guesser } = tamilTurn();
    r.handleChat(guesser, 'யனை'); // missing vowel sign: a different (non-)word
    expect(r.phase).toBe('drawing');
  });
});

// ------------------------------------------------------------------ 7. Avatars and titles in rooms
describe('Player looks', () => {
  it('shows the validated avatar and title, and updates them live', () => {
    const h = createRoomHarness('private');
    h.room.join(P1, 'Ann', { avatar: 17, title: 'team-champion' });
    let me = h.room.toState().players[0]!;
    expect(me).toMatchObject({ avatar: 17, title: 'team-champion' });
    h.room.setLook(P1, { avatar: 3, title: null });
    me = h.room.toState().players[0]!;
    expect(me).toMatchObject({ avatar: 3, title: null });
  });
});

describe('state shape', () => {
  it('exposes the new fields without leaking the word', () => {
    const h = room({ collaborative: true, teams: false }, [P1, P2, P3]);
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    const state: RoomState = h.room.toState();
    expect(state.artistIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(state)).not.toContain(`"${h.room.currentWord}"`);
  });
});

describe('Chat visibility while drawing', () => {
  it('shows the drawer\'s chat to everyone, but keeps chat from players who guessed private', () => {
    const h = createRoomHarness('private', { rounds: 1 });
    h.room.join(P1, 'Drawer');
    h.room.join(P2, 'Guesser');
    h.room.join(P3, 'Fast');
    h.room.startGame(P1);
    h.room.chooseWord(P1, 0);
    h.room.handleChat(P1, 'hiii, good luck everyone');
    const drawerMsg = h.sent.filter((e) => e.event === 'chat:message' && (e.payload as ChatMessage).text === 'hiii, good luck everyone');
    expect(drawerMsg).toHaveLength(1);
    expect(drawerMsg[0]!.to).toBe('all');
    expect((drawerMsg[0]!.payload as ChatMessage).kind).toBe('chat');

    // The drawer still can't type the answer.
    h.room.handleChat(P1, `it is ${h.room.currentWord}`);
    expect(h.sent.some((e) => e.to === 'all' && JSON.stringify(e.payload).includes(`it is ${h.room.currentWord}`))).toBe(false);

    h.room.handleChat(P3, h.room.currentWord!);
    h.room.handleChat(P3, 'that was easy');
    const secret = h.sent.find((e) => (e.payload as ChatMessage).text === 'that was easy')!;
    expect(secret.to).not.toBe('all');
    expect(secret.to).not.toContain(P2);
  });
});
