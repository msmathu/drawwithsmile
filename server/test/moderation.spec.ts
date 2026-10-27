import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, type Database } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { ModerationService, isPublicIp } from '../src/services/moderation.service.js';
import { silentLogger } from '../src/utils/logger.js';
import { createRoomHarness, P1, P2, P3, P4 } from './helpers.js';
import { GameError } from '../src/utils/errors.js';

const SECRET = 'moderation-test-secret-moderation-test';
const TARGET = '99999999-9999-4999-8999-999999999999';
const reporterId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const report = (i: number, reporterIp: string, reportedIp: string | null = '203.0.113.50') => ({
  reporterId: reporterId(i),
  reporterIp,
  reportedId: TARGET,
  reportedIp,
  reportedNickname: 'Troll',
  roomCode: 'ABCDEFGH',
  reason: 'offensive' as const,
});

describe('isPublicIp', () => {
  it('never treats shared or private networks as one person', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.55', '169.254.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.0.2', 'unknown']) {
      expect(isPublicIp(ip)).toBe(false);
    }
    for (const ip of ['203.0.113.50', '8.8.8.8', '::ffff:198.51.100.7', '2001:db8::1']) expect(isPublicIp(ip)).toBe(true);
  });
});

describe('ModerationService (in memory)', () => {
  it('bans only when MORE than the threshold of different players reported', async () => {
    const mod = new ModerationService(null, SECRET, 10, silentLogger);
    for (let i = 1; i <= 10; i++) {
      const outcome = await mod.report(report(i, `198.51.100.${i}`));
      expect(outcome.banned).toBe(false);
    }
    expect(mod.isBanned(TARGET, '203.0.113.50')).toBe(false);
    const eleventh = await mod.report(report(11, '198.51.100.11'));
    expect(eleventh).toMatchObject({ banned: true, reporters: 11 });
    expect(mod.isBanned(TARGET, null)).toBe(true); // player id banned
    expect(mod.isBanned('11111111-1111-4111-8111-111111111111', '203.0.113.50')).toBe(true); // new account, same IP
    expect(mod.isBanned('11111111-1111-4111-8111-111111111111', '203.0.113.51')).toBe(false);
  });

  it('counts one person with many guest accounts on the same connection only once', async () => {
    const mod = new ModerationService(null, SECRET, 10, silentLogger);
    for (let i = 1; i <= 20; i++) await mod.report(report(i, '198.51.100.99'));
    expect(mod.isBanned(TARGET, null)).toBe(false);
    const again = await mod.report(report(1, '198.51.100.99'));
    expect(again).toMatchObject({ duplicate: true, reporters: 1 });
  });

  it('does not IP-ban shared/private networks (only the player id)', async () => {
    const mod = new ModerationService(null, SECRET, 2, silentLogger);
    for (let i = 1; i <= 3; i++) await mod.report(report(i, '192.168.1.10', '192.168.1.20'));
    expect(mod.isBanned(TARGET, '192.168.1.20')).toBe(true);
    expect(mod.isBanned('11111111-1111-4111-8111-111111111111', '192.168.1.20')).toBe(false); // LAN neighbours unaffected
  });
});

describe('ModerationService (database)', () => {
  let db: Database;
  afterEach(async () => db?.close());

  it('stores hashed IPs, rejects duplicates and keeps bans after a restart', async () => {
    db = await createDatabase({ mode: 'memory' } as never);
    await runMigrations(db, silentLogger);
    const mod = new ModerationService(db, SECRET, 10, silentLogger);
    for (let i = 1; i <= 11; i++) await mod.report(report(i, `198.51.100.${i}`));
    expect((await mod.report(report(1, '198.51.100.1'))).duplicate).toBe(true);

    const stored = JSON.stringify((await db.query('SELECT * FROM reports')).rows) + JSON.stringify((await db.query('SELECT * FROM player_bans')).rows);
    expect(stored).not.toContain('203.0.113.50');
    expect(stored).not.toContain('198.51.100.');
    const bans = await db.query<{ player_id: string; ip_hash: string; report_count: number }>('SELECT * FROM player_bans');
    expect(bans.rows).toHaveLength(1);
    expect(bans.rows[0]).toMatchObject({ player_id: TARGET, report_count: 11 });
    expect(bans.rows[0]!.ip_hash).toMatch(/^[0-9a-f]{64}$/);

    const afterRestart = new ModerationService(db, SECRET, 10, silentLogger);
    await afterRestart.init();
    expect(afterRestart.isBanned(TARGET, null)).toBe(true);
    expect(afterRestart.isBanned(reporterId(50), '203.0.113.50')).toBe(true);
  });
});

describe('Room admin bans (temporary, this room only)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('lets the admin ban anyone mid-game for 5 minutes, including a new account on the same connection', () => {
    const h = createRoomHarness('private', { rounds: 1 });
    h.room.join(P1, 'Host');
    h.room.join(P2, 'Ben', undefined, 'ipkey-ben');
    h.room.join(P3, 'Cat');
    h.room.startGame(P1);
    h.room.kick(P1, P2, 5); // during a game
    expect(h.room.hasPlayer(P2)).toBe(false);
    expect(h.removed.at(-1)!.reason).toMatch(/banned you from this room for 5 minutes. You can still play in other rooms/);
    expect(() => h.room.join(P2, 'Ben')).toThrow(/banned from this room for 5 more minutes/);
    expect(() => h.room.join(P4, 'Ben again', undefined, 'ipkey-ben')).toThrow(GameError);
    expect(h.room.canAccept(P4, 'someone-else')).toBe(true);

    // The ban runs out by itself.
    vi.advanceTimersByTime(4 * 60_000);
    expect(() => h.room.join(P2, 'Ben')).toThrow(/1 more minute\b/);
    vi.advanceTimersByTime(60_000 + 1);
    expect(h.room.join(P2, 'Ben')).toBe('joined');
  });

  it('only affects this room', () => {
    const a = createRoomHarness('private');
    const b = createRoomHarness('private');
    a.room.join(P1, 'Host');
    a.room.join(P2, 'Ben', undefined, 'ipkey-ben');
    a.room.kick(P1, P2, 30);
    expect(a.room.canAccept(P2, 'ipkey-ben')).toBe(false);
    b.room.join(P3, 'Other host');
    expect(b.room.join(P2, 'Ben', undefined, 'ipkey-ben')).toBe('joined');
  });

  it('never allows an admin ban without a time limit', () => {
    const h = createRoomHarness('private');
    h.room.join(P1, 'Host');
    h.room.join(P2, 'Ben');
    expect(() => h.room.kick(P1, P2, Infinity)).toThrow(/time limit/);
    expect(() => h.room.kick(P1, P2, 0)).toThrow(/time limit/);
    expect(h.room.hasPlayer(P2)).toBe(true);
  });

  it('does not let other players ban', () => {
    const h = createRoomHarness('private');
    h.room.join(P1, 'Host');
    h.room.join(P2, 'Ben');
    h.room.join(P3, 'Cat');
    expect(() => h.room.kick(P2, P3, 5)).toThrow(/Only the room admin/);
  });

  it('makes the creator of a public room its admin; Quick Play rooms have none', () => {
    const created = createRoomHarness('public', {}, P1);
    created.room.join(P1, 'Creator');
    created.room.join(P2, 'Ben');
    expect(created.room.hostId).toBe(P1);
    created.room.kick(P1, P2, 5);
    expect(created.room.hasPlayer(P2)).toBe(false);

    const quick = createRoomHarness('public');
    quick.room.join(P1, 'Ann');
    quick.room.join(P2, 'Ben');
    expect(quick.room.hostId).toBeNull();
    expect(() => quick.room.kick(P1, P2, 5)).toThrow(/Only the room admin/);
  });
});

describe('Banning during a 4-player game', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fourPlayerGame() {
    const h = createRoomHarness('private', { rounds: 2 });
    h.room.join(P1, 'Admin');
    h.room.join(P2, 'Ben');
    h.room.join(P3, 'Cat');
    h.room.join(P4, 'Dan');
    h.room.startGame(P1);
    h.room.chooseWord(h.room.currentDrawerId!, 0);
    return h;
  }

  it('keeps the turn going when a guesser is banned, and keeps everyone\'s score', () => {
    const h = fourPlayerGame();
    const drawer = h.room.currentDrawerId!;
    const [guesserA, banned] = [P2, P3, P4].filter((p) => p !== drawer);
    h.room.handleChat(guesserA!, h.room.currentWord!); // someone scores first
    const scoreBefore = h.room.toState().players.find((p) => p.id === guesserA)!.score;
    h.room.kick(P1 === banned ? P2 : P1, banned!, 5);
    expect(h.room.phase).toBe('drawing'); // not stopped
    expect(h.room.currentDrawerId).toBe(drawer);
    expect(h.room.toState().players).toHaveLength(3);
    expect(h.room.toState().players.find((p) => p.id === guesserA)!.score).toBe(scoreBefore);
  });

  it('moves on to the next drawer when the drawer is banned, and the game continues', () => {
    const h = createRoomHarness('private', { rounds: 2 });
    h.room.join(P1, 'Admin');
    h.room.join(P2, 'Ben');
    h.room.join(P3, 'Cat');
    h.room.join(P4, 'Dan');
    h.room.startGame(P1);
    vi.advanceTimersByTime(5_000 + 60_000 + 5_000); // Admin's turn passes; Ben draws next
    expect(h.room.currentDrawerId).toBe(P2);
    h.room.chooseWord(P2, 0);
    h.room.kick(P1, P2, 5);
    expect(h.room.phase).toBe('turnEnd');
    expect(h.room.toState().lastTurn!.reason).toBe('drawer-left');
    vi.advanceTimersByTime(5_000);
    expect(h.room.phase).toBe('choosing'); // next turn started
    expect([P3, P4]).toContain(h.room.currentDrawerId);
    expect(h.room.toState().round).toBe(1);
  });

  it('only ends the game when fewer than 2 players are left', () => {
    const h = createRoomHarness('private', { rounds: 2 });
    h.room.join(P1, 'Admin');
    h.room.join(P2, 'Ben');
    h.room.startGame(P1);
    h.room.kick(P1, P2, 5);
    expect(h.room.phase).toBe('gameEnd');
  });
});
