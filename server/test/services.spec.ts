import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@dws/shared';
import { RoomManager } from '../src/services/room-manager.js';
import { drawerPointsPerGuess, guesserPoints, rankByScore } from '../src/services/scoring.js';
import { SessionService } from '../src/services/session.service.js';
import { WordService, builtInWords } from '../src/services/word.service.js';
import { silentLogger } from '../src/utils/logger.js';
import { censor, containsProfanity } from '../src/utils/profanity.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { generateRoomCode } from '../src/utils/ids.js';
import { clientIp } from '../src/utils/network.js';
import { isValidRoomCode } from '@dws/shared';
import { P1, P2, P3, TEST_WORDS } from './helpers.js';
import type { RoomOutput } from '../src/models/room.js';

describe('scoring', () => {
  it('rewards speed and order', () => {
    const fast = guesserPoints({ remainingMs: 60_000, totalMs: 60_000, order: 0, difficulty: 'easy' });
    const slow = guesserPoints({ remainingMs: 1_000, totalMs: 60_000, order: 3, difficulty: 'easy' });
    expect(fast).toBe(180);
    expect(slow).toBe(52);
  });

  it('scales with difficulty and clamps bad input', () => {
    expect(guesserPoints({ remainingMs: 0, totalMs: 60_000, order: 5, difficulty: 'hard' })).toBe(75);
    expect(guesserPoints({ remainingMs: 999_999, totalMs: 60_000, order: 5, difficulty: 'easy' })).toBe(150);
    expect(guesserPoints({ remainingMs: -5, totalMs: 0, order: 5, difficulty: 'easy' })).toBe(50);
    expect(drawerPointsPerGuess('medium')).toBe(30);
  });

  it('ranks ties together', () => {
    const ranked = rankByScore([
      { id: 'a', score: 10 },
      { id: 'b', score: 30 },
      { id: 'c', score: 10 },
      { id: 'd', score: 5 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
      ['d', 4],
    ]);
  });
});

describe('SessionService', () => {
  const sessions = new SessionService('test-secret-test-secret-test-secret');

  it('issues tokens that verify to the same player', () => {
    const s = sessions.createSession();
    expect(sessions.verify(s.token)).toBe(s.playerId);
    expect(sessions.resume(s.token).playerId).toBe(s.playerId);
  });

  it('rejects tampered or foreign tokens', () => {
    const s = sessions.createSession();
    const other = new SessionService('another-secret-another-secret-12');
    expect(other.verify(s.token)).toBeNull();
    expect(sessions.verify(s.token.replace(s.playerId, '11111111-1111-4111-8111-111111111111'))).toBeNull();
    expect(sessions.verify('garbage')).toBeNull();
    expect(sessions.verify(42)).toBeNull();
    expect(sessions.resume('garbage').playerId).not.toBe(s.playerId);
  });
});

describe('RateLimiter', () => {
  it('allows bursts up to capacity then refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1, () => now);
    expect([limiter.take('k'), limiter.take('k'), limiter.take('k'), limiter.take('k')]).toEqual([true, true, true, false]);
    now += 1_000;
    expect(limiter.take('k')).toBe(true);
    expect(limiter.take('k')).toBe(false);
    expect(limiter.take('other')).toBe(true);
    now += 10_000;
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});

describe('WordService', () => {
  it('offers one word per difficulty in mixed mode', () => {
    const words = new WordService(TEST_WORDS);
    const choices = words.pickChoices({ language: 'en', difficulty: 'mixed', categories: [], exclude: new Set() });
    expect(choices.map((c) => c.difficulty)).toEqual(['easy', 'medium', 'hard']);
  });

  it('respects language, categories and recently used words', () => {
    const words = new WordService(builtInWords());
    const tamil = words.pickChoices({ language: 'ta', difficulty: 'mixed', categories: ['animals'], exclude: new Set() });
    expect(tamil).toHaveLength(3);
    expect(tamil.every((w) => w.language === 'ta' && w.category === 'animals')).toBe(true);
    const easy = words.pickChoices({ language: 'en', difficulty: 'easy', categories: [], exclude: new Set() });
    expect(new Set(easy.map((w) => w.text)).size).toBe(3);
    expect(easy.every((w) => w.difficulty === 'easy')).toBe(true);

    const small = new WordService(TEST_WORDS);
    const picked = small.pickChoices({ language: 'en', difficulty: 'easy', categories: [], exclude: new Set(['banana']) });
    expect(picked.map((w) => w.text)).not.toContain('banana');
    // With too few fresh words, recently used ones fill the gap instead of returning fewer choices.
    const tight = small.pickChoices({ language: 'en', difficulty: 'mixed', categories: ['food'], exclude: new Set(['banana']) });
    expect(tight.map((w) => w.text).sort()).toEqual(['banana', 'hot dog']);
  });

  it('ships a sizeable built-in list in both languages', () => {
    const counts = new WordService().countsByLanguage();
    expect(counts.en).toBeGreaterThan(250);
    expect(counts.ta).toBeGreaterThan(150);
  });
});

describe('RoomManager', () => {
  const output: RoomOutput = { toAll() {}, toPlayers() {}, playerRemoved() {} };
  const createManager = () =>
    new RoomManager({ words: new WordService(TEST_WORDS), logger: silentLogger, createOutput: () => output });

  it('creates rooms with unique valid codes', () => {
    const manager = createManager();
    const codes = new Set(Array.from({ length: 50 }, () => manager.create('private').code));
    expect(codes.size).toBe(50);
    expect([...codes].every(isValidRoomCode)).toBe(true);
    expect(isValidRoomCode(generateRoomCode())).toBe(true);
  });

  it('matches quick-play players into the fullest waiting public room of their language', () => {
    vi.useFakeTimers();
    const manager = createManager();
    const a = manager.create('public');
    const b = manager.create('public');
    manager.create('public', { ...DEFAULT_SETTINGS, language: 'ta' });
    manager.join(b, P1, 'Alice');
    expect(manager.findPublicRoom('en', P2)).toBe(b);
    manager.join(a, P2, 'Bob');
    manager.join(a, P3, 'Cara');
    expect(manager.findPublicRoom('en', '44444444-4444-4444-8444-444444444444')).toBe(a);
    vi.useRealTimers();
    manager.shutdown();
  });

  it('gives rooms unique random names and rejects duplicate custom names', () => {
    const manager = createManager();
    const names = Array.from({ length: 60 }, () => manager.create('public').name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(60);
    expect(names.every((n) => /^The \w+ Room\d*$/.test(n))).toBe(true);
    manager.create('private', DEFAULT_SETTINGS, { name: 'Friday Fun' });
    expect(() => manager.create('private', DEFAULT_SETTINGS, { name: 'friday FUN' })).toThrow(/already exists/);
    manager.shutdown();
  });

  it('lists public and listed private rooms, and finds rooms by name or code', () => {
    const manager = createManager();
    const pub = manager.create('public', DEFAULT_SETTINGS, { name: 'Sunny Room' });
    const listed = manager.create('private', DEFAULT_SETTINGS, { name: 'Ben and Jerry' });
    const hidden = manager.create('private', DEFAULT_SETTINGS, { name: 'Secret Club', listed: false });
    manager.join(pub, P1, 'Alice');
    manager.join(listed, P2, 'Bob');
    manager.join(hidden, P3, 'Cara');
    const dir = manager.directory(3);
    expect(dir.publicRooms.map((r) => r.name)).toEqual(['Sunny Room']);
    expect(dir.privateRooms.map((r) => r.name)).toEqual(['Ben and Jerry']);
    expect(dir.totals).toEqual({ publicRooms: 1, publicPlayers: 1, privateRooms: 2, privatePlayers: 2 });
    expect(JSON.stringify(dir)).not.toContain(hidden.code);
    expect(manager.findByNameOrCode('ben AND jerry')).toBe(listed);
    expect(manager.findByNameOrCode('Secret Club')).toBeUndefined();
    expect(manager.findByNameOrCode(hidden.code.toLowerCase())).toBe(hidden);
    manager.leave(P2);
    expect(manager.findByNameOrCode('Ben and Jerry')).toBeUndefined();
    manager.shutdown();
  });

  it('matches quick-play players into public games already in progress', () => {
    vi.useFakeTimers();
    const manager = createManager();
    const room = manager.create('public');
    manager.join(room, P1, 'Alice');
    manager.join(room, P2, 'Bob');
    room.startGame(null);
    expect(manager.findPublicRoom('en', P3)).toBe(room);
    vi.useRealTimers();
    manager.shutdown();
  });

  it('moves a player between rooms and forgets empty rooms', () => {
    const manager = createManager();
    const a = manager.create('private');
    const b = manager.create('private');
    manager.join(a, P1, 'Alice');
    manager.join(b, P1, 'Alice');
    expect(manager.roomOf(P1)).toBe(b);
    expect(manager.get(a.code)).toBeUndefined();
    manager.leave(P1);
    expect(manager.roomOf(P1)).toBeUndefined();
    expect(manager.stats().rooms).toBe(0);
  });

  it('caps the number of rooms', () => {
    const manager = new RoomManager({
      words: new WordService(TEST_WORDS),
      logger: silentLogger,
      createOutput: () => output,
      maxRooms: 2,
    });
    manager.create('private');
    manager.create('private');
    expect(() => manager.create('private')).toThrow(/busy/);
  });
});

describe('profanity filter', () => {
  it('catches common words and obfuscations', () => {
    expect(containsProfanity('sh1t')).toBe(true);
    expect(containsProfanity('F.U.C.K')).toBe(true);
    expect(containsProfanity('Happy Painter')).toBe(false);
    expect(containsProfanity('Scunthorpe')).toBe(false);
    expect(censor('you are a b1tch ok')).toBe('you are a ***** ok');
  });
});

describe('clientIp', () => {
  it('only trusts forwarded addresses added by trusted proxies', () => {
    expect(clientIp('1.1.1.1, 2.2.2.2', '10.0.0.1', 0)).toBe('10.0.0.1');
    expect(clientIp('spoofed, 2.2.2.2', '10.0.0.1', 1)).toBe('2.2.2.2');
  });
});
