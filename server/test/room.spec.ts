import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TIMINGS, type ChatMessage, type RoomState } from '@dws/shared';
import { GameError } from '../src/utils/errors.js';
import { createRoomHarness, flush, P1, P2, P3 } from './helpers.js';

const chunk = (id: string, final = true) => ({ id, tool: 'pen' as const, color: '#000000', size: 6, points: [10, 10, 20, 20], final });

function startTwoPlayerGame(settings = {}) {
  const h = createRoomHarness('private', { rounds: 1, drawTime: 60, ...settings });
  h.room.join(P1, 'Alice');
  h.room.join(P2, 'Bob');
  h.room.startGame(P1);
  return h;
}

function expectGameError(fn: () => void, code: string) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(GameError);
    expect((err as GameError).code).toBe(code);
    return;
  }
  throw new Error(`Expected GameError ${code}`);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Room membership', () => {
  it('makes the first player host of a private room and broadcasts state', async () => {
    const { room, sent } = createRoomHarness();
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    expect(room.hostId).toBe(P1);
    await flush();
    const state = sent.filter((e) => e.event === 'room:state').at(-1)!.payload as RoomState;
    expect(state.players.map((p) => p.nickname)).toEqual(['Alice', 'Bob']);
    expect(state.players[0]!.isHost).toBe(true);
  });

  it('has no host in public rooms', () => {
    const { room } = createRoomHarness('public');
    room.join(P1, 'Alice');
    expect(room.hostId).toBeNull();
  });

  it('makes duplicate nicknames unique', () => {
    const { room } = createRoomHarness();
    room.join(P1, 'Sam');
    room.join(P2, 'sam');
    expect(room.toState().players.map((p) => p.nickname)).toEqual(['Sam', 'sam 2']);
  });

  it('rejects joins when the room is full', () => {
    const { room } = createRoomHarness('private', { maxPlayers: 2 });
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    expectGameError(() => room.join(P3, 'Cara'), 'room-full');
  });

  it('lets new players join a game in progress as guessers who draw from the next round', () => {
    const { room, receivedBy } = createRoomHarness('private', { rounds: 2 });
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.startGame(P1);
    const drawer = room.currentDrawerId!;
    room.chooseWord(drawer, 0);
    room.drawChunk(drawer, chunk('strokeLate'));
    expect(room.join(P3, 'Cara')).toBe('joined');
    room.syncPlayer(P3);
    const history = receivedBy(P3, 'draw:history').at(-1)!.payload as { id: string }[];
    expect(history.map((o) => o.id)).toEqual(['strokeLate']);
    room.handleChat(P3, room.currentWord!);
    expect(room.toState().players.find((p) => p.id === P3)!.score).toBeGreaterThan(0);
    // Round 1 queue was fixed at the start: the late joiner draws in round 2.
    vi.advanceTimersByTime(60_000 + TIMINGS.TURN_END_MS);
    expect(room.currentDrawerId).not.toBe(P3);
  });

  it('hides a room from the lists after several name reports', () => {
    const { room } = createRoomHarness();
    expect(room.listed).toBe(true);
    expect(room.reportName(P1)).toBe(true);
    expect(room.reportName(P1)).toBe(false);
    room.reportName(P2);
    expect(room.listed).toBe(true);
    room.reportName(P3);
    expect(room.listed).toBe(false);
  });

  it('lets existing members rejoin a game in progress', () => {
    const { room } = startTwoPlayerGame();
    room.markDisconnected(P2);
    expect(room.join(P2, 'Bob')).toBe('rejoined');
    expect(room.toState().players.find((p) => p.id === P2)!.connected).toBe(true);
  });

  it('removes a disconnected player after the grace period', () => {
    const { room, removed } = createRoomHarness();
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.markDisconnected(P2);
    vi.advanceTimersByTime(TIMINGS.LOBBY_RECONNECT_GRACE_MS - 1);
    expect(room.hasPlayer(P2)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(room.hasPlayer(P2)).toBe(false);
    expect(removed).toEqual([{ playerId: P2, reason: null }]);
  });

  it('reassigns the host when the host leaves', () => {
    const { room } = createRoomHarness();
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.removePlayer(P1, 'left');
    expect(room.hostId).toBe(P2);
  });
});

describe('Game flow', () => {
  it('only the host can start, and needs two connected players', () => {
    const { room } = createRoomHarness();
    room.join(P1, 'Alice');
    expectGameError(() => room.startGame(P1), 'not-enough-players');
    room.join(P2, 'Bob');
    expectGameError(() => room.startGame(P2), 'not-host');
    room.startGame(P1);
    expect(room.phase).toBe('choosing');
  });

  it('sends word choices only to the drawer and lets only the drawer choose', () => {
    const { room, receivedBy } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    const guesser = drawer === P1 ? P2 : P1;
    expect(receivedBy(drawer, 'turn:choices')).toHaveLength(1);
    expect(receivedBy(guesser, 'turn:choices')).toHaveLength(0);
    expectGameError(() => room.chooseWord(guesser, 0), 'not-drawer');
    room.chooseWord(drawer, 0);
    expect(room.phase).toBe('drawing');
    expect(receivedBy(drawer, 'turn:word')).toHaveLength(1);
    expect(receivedBy(guesser, 'turn:word')).toHaveLength(0);
  });

  it('auto-picks a word when the drawer does not choose in time', () => {
    const { room } = startTwoPlayerGame();
    vi.advanceTimersByTime(TIMINGS.CHOOSE_WORD_MS);
    expect(room.phase).toBe('drawing');
    expect(room.currentWord).not.toBeNull();
  });

  it('never sends the secret word to guessers while drawing', () => {
    const { room, sent } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    room.chooseWord(drawer, 0);
    const word = room.currentWord!;
    const guesser = drawer === P1 ? P2 : P1;
    room.handleChat(guesser, 'is it a dog?');
    room.handleChat(drawer, `hint: ${word}`);
    vi.advanceTimersByTime(30_000);
    const state = room.toState();
    expect(state.hint!.filter((c) => c === null).length).toBeGreaterThan(0);
    const leaked = sent.filter(
      (e) => (e.to === 'all' || e.to.includes(guesser)) && JSON.stringify(e.payload).includes(`"${word}"`),
    );
    expect(leaked).toEqual([]);
  });

  it('scores a correct guess, rewards the drawer and ends the turn when everyone guessed', () => {
    const { room, sent } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    const guesser = drawer === P1 ? P2 : P1;
    room.chooseWord(drawer, 0);
    vi.advanceTimersByTime(10_000);
    room.handleChat(guesser, `  ${room.currentWord!.toUpperCase()} `);

    const state = room.toState();
    const g = state.players.find((p) => p.id === guesser)!;
    const d = state.players.find((p) => p.id === drawer)!;
    expect(g.score).toBeGreaterThan(100);
    expect(d.score).toBeGreaterThan(0);
    expect(room.phase).toBe('turnEnd');
    expect(state.lastTurn!.reason).toBe('all-guessed');
    expect(sent.some((e) => e.event === 'chat:message' && (e.payload as ChatMessage).kind === 'correct')).toBe(true);
  });

  it('gives earlier guessers more points', () => {
    const h = createRoomHarness('private', { rounds: 1 });
    h.room.join(P1, 'Alice');
    h.room.join(P2, 'Bob');
    h.room.join(P3, 'Cara');
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    const [first, second] = [P1, P2, P3].filter((p) => p !== drawer);
    h.room.chooseWord(drawer, 0);
    vi.advanceTimersByTime(5_000);
    h.room.handleChat(first!, h.room.currentWord!);
    vi.advanceTimersByTime(30_000);
    h.room.handleChat(second!, h.room.currentWord!);
    const scores = Object.fromEntries(h.room.toState().players.map((p) => [p.id, p.score]));
    expect(scores[first!]).toBeGreaterThan(scores[second!]!);
  });

  it('ends the turn when time runs out and reveals hints along the way', () => {
    const { room } = startTwoPlayerGame({ drawTime: 60 });
    room.chooseWord(room.currentDrawerId!, 1); // "giraffe" (medium) has 2 hints
    const hidden = () => room.toState().hint!.filter((c) => c === null).length;
    const initial = hidden();
    vi.advanceTimersByTime(55_000);
    expect(hidden()).toBeLessThan(initial);
    vi.advanceTimersByTime(5_000);
    expect(room.phase).toBe('turnEnd');
    expect(room.toState().lastTurn!.reason).toBe('time-up');
  });

  it('rotates drawers and finishes the game after all rounds', () => {
    const { room, games } = startTwoPlayerGame({ rounds: 1 });
    const firstDrawer = room.currentDrawerId!;
    vi.advanceTimersByTime(TIMINGS.CHOOSE_WORD_MS + 60_000 + TIMINGS.TURN_END_MS);
    expect(room.phase).toBe('choosing');
    expect(room.currentDrawerId).not.toBe(firstDrawer);
    vi.advanceTimersByTime(TIMINGS.CHOOSE_WORD_MS + 60_000 + TIMINGS.TURN_END_MS);
    expect(room.phase).toBe('gameEnd');
    expect(room.toState().standings).toHaveLength(2);
    expect(games).toHaveLength(1);
    expect(games[0]!.completed).toBe(true);
    expect(games[0]!.turns).toHaveLength(2);

    vi.advanceTimersByTime(TIMINGS.GAME_END_RETURN_MS);
    expect(room.phase).toBe('lobby');
    expect(room.toState().players.every((p) => p.score === 0)).toBe(true);
  });

  it('ends the turn when the drawer leaves and the game when too few players remain', () => {
    const h = createRoomHarness('private', { rounds: 2 });
    h.room.join(P1, 'Alice');
    h.room.join(P2, 'Bob');
    h.room.join(P3, 'Cara');
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    h.room.chooseWord(drawer, 0);
    h.room.removePlayer(drawer, 'left');
    expect(h.room.phase).toBe('turnEnd');
    expect(h.room.toState().lastTurn!.reason).toBe('drawer-left');
    const remaining = [P1, P2, P3].filter((p) => p !== drawer);
    h.room.removePlayer(remaining[0]!, 'left');
    expect(h.room.phase).toBe('gameEnd');
  });
});

describe('Chat during a turn', () => {
  it('keeps chat from players who guessed among drawer and guessers', () => {
    const h = createRoomHarness('private', { rounds: 1 });
    h.room.join(P1, 'Alice');
    h.room.join(P2, 'Bob');
    h.room.join(P3, 'Cara');
    h.room.startGame(P1);
    const drawer = h.room.currentDrawerId!;
    const [guesser, other] = [P1, P2, P3].filter((p) => p !== drawer);
    h.room.chooseWord(drawer, 0);
    h.room.handleChat(guesser!, h.room.currentWord!);
    h.room.handleChat(guesser!, 'that was easy');
    const secret = h.sent.filter((e) => e.event === 'chat:message' && (e.payload as ChatMessage).kind === 'guessed-chat');
    expect(secret).toHaveLength(1);
    expect(secret[0]!.to).toEqual(expect.arrayContaining([drawer, guesser]));
    expect(secret[0]!.to).not.toContain(other);
  });

  it('tells a player privately when a guess is close', () => {
    const h = startTwoPlayerGame();
    const drawer = h.room.currentDrawerId!;
    const guesser = drawer === P1 ? P2 : P1;
    h.room.chooseWord(drawer, 1); // giraffe
    h.room.handleChat(guesser, 'girafe');
    const close = h.sent.filter((e) => (e.payload as ChatMessage).kind === 'close');
    expect(close).toHaveLength(1);
    expect(close[0]!.to).toEqual([guesser]);
  });

  it('rejects muted players and repeated messages', () => {
    const { room } = createRoomHarness();
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.handleChat(P2, 'hello');
    expectGameError(() => room.handleChat(P2, 'hello'), 'rate-limited');
    room.setMuted(P1, P2, true);
    expectGameError(() => room.handleChat(P2, 'hi again'), 'muted');
  });

  it('censors profanity in chat', () => {
    const { room, sent } = createRoomHarness();
    room.join(P1, 'Alice');
    room.handleChat(P1, 'what the fuck');
    const msg = sent.filter((e) => e.event === 'chat:message').at(-1)!.payload as ChatMessage;
    expect(msg.text).toBe('what the ****');
  });
});

describe('Drawing permissions and history', () => {
  it('only accepts strokes from the drawer during the drawing phase', () => {
    const { room, receivedBy } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    const guesser = drawer === P1 ? P2 : P1;
    expectGameError(() => room.drawChunk(drawer, chunk('stroke1')), 'not-drawer'); // still choosing
    room.chooseWord(drawer, 0);
    expectGameError(() => room.drawChunk(guesser, chunk('stroke1')), 'not-drawer');
    room.drawChunk(drawer, chunk('stroke1'));
    expect(receivedBy(guesser, 'draw:chunk')).toHaveLength(1);
    expect(receivedBy(drawer, 'draw:chunk')).toHaveLength(0);
  });

  it('supports undo, redo and clear with a replayable history', () => {
    const { room } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    room.chooseWord(drawer, 0);
    room.drawChunk(drawer, chunk('strokeA', false));
    room.drawChunk(drawer, { ...chunk('strokeA'), color: '#ef4444', points: [30, 30] });
    room.drawChunk(drawer, chunk('strokeB'));
    const history = room.drawHistory();
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ id: 'strokeA', color: '#000000', points: [10, 10, 20, 20, 30, 30] });

    room.undo(drawer);
    expect(room.drawHistory().map((o) => o.id)).toEqual(['strokeA']);
    room.redo(drawer);
    expect(room.drawHistory().map((o) => o.id)).toEqual(['strokeA', 'strokeB']);
    room.clear(drawer);
    expect(room.drawHistory().at(-1)!.kind).toBe('clear');
    room.undo(drawer);
    expect(room.drawHistory().map((o) => o.id)).toEqual(['strokeA', 'strokeB']);
    expectGameError(() => room.drawChunk(drawer, chunk('strokeA')), 'bad-request'); // id reuse
  });

  it('clears the drawing when the next turn starts', () => {
    const { room } = startTwoPlayerGame();
    const drawer = room.currentDrawerId!;
    room.chooseWord(drawer, 0);
    room.drawChunk(drawer, chunk('strokeA'));
    vi.advanceTimersByTime(60_000 + TIMINGS.TURN_END_MS);
    expect(room.drawHistory()).toEqual([]);
  });
});

describe('Public rooms and moderation', () => {
  it('starts a public game automatically once two players are waiting', () => {
    const { room } = createRoomHarness('public');
    room.join(P1, 'Alice');
    expect(room.toState().autoStartInMs).toBeNull();
    room.join(P2, 'Bob');
    expect(room.toState().autoStartInMs).toBe(TIMINGS.PUBLIC_AUTOSTART_MS);
    vi.advanceTimersByTime(TIMINGS.PUBLIC_AUTOSTART_MS);
    expect(room.phase).toBe('choosing');
  });

  it('cancels the auto start when a player leaves', () => {
    const { room } = createRoomHarness('public');
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.removePlayer(P2, 'left');
    vi.advanceTimersByTime(TIMINGS.PUBLIC_AUTOSTART_MS);
    expect(room.phase).toBe('lobby');
  });

  it('removes and bans a player after enough votes', () => {
    const { room, removed } = createRoomHarness('public');
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.join(P3, 'Cara');
    room.voteKick(P1, P3);
    expect(room.hasPlayer(P3)).toBe(true);
    expectGameError(() => room.voteKick(P1, P3), 'bad-request');
    room.voteKick(P2, P3);
    expect(room.hasPlayer(P3)).toBe(false);
    expect(removed[0]!.reason).toMatch(/vote/);
    expect(room.canAccept(P3)).toBe(false);
  });

  it('lets only the host kick or ban in private rooms', () => {
    const { room, removed } = createRoomHarness();
    room.join(P1, 'Alice');
    room.join(P2, 'Bob');
    room.join(P3, 'Cara');
    expectGameError(() => room.kick(P2, P3, false), 'not-host');
    room.kick(P1, P2, false);
    expect(room.canAccept(P2)).toBe(true);
    room.kick(P1, P3, true);
    expect(room.canAccept(P3)).toBe(false);
    expect(removed.map((r) => r.playerId)).toEqual([P2, P3]);
  });
});
