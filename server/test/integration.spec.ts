import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  AckResponse,
  ChatMessage,
  ClientToServerEvents,
  DrawOp,
  RoomDirectory,
  RoomState,
  ServerToClientEvents,
  SessionInfo,
  StrokeChunk,
} from '@dws/shared';
import { loadConfig } from '../src/config/env.js';
import { createDatabase, type Database } from '../src/database/db.js';
import { runMigrations } from '../src/database/migrate.js';
import { seedDatabase } from '../src/database/seed.js';
import { createGameServer, type GameServer } from '../src/server.js';
import { silentLogger } from '../src/utils/logger.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: GameServer;
let db: Database;
let baseUrl: string;
const sockets: ClientSocket[] = [];

beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'integration-test-secret-integration', CLIENT_ORIGINS: '*' });
  db = await createDatabase({ ...config.db, mode: 'memory' });
  await runMigrations(db, silentLogger);
  await seedDatabase(db, silentLogger);
  server = await createGameServer(config, silentLogger, { db });
  const port = await server.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
  await db.close();
});

async function newSession(): Promise<SessionInfo> {
  const res = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return (await res.json()) as SessionInfo;
}

/** Connects a client; it records every state/chat/draw event it receives. */
async function client(session?: SessionInfo) {
  const s = session ?? (await newSession());
  const socket: ClientSocket = connect(baseUrl, { auth: { token: s.token }, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  const log = {
    states: [] as RoomState[],
    chat: [] as ChatMessage[],
    chunks: [] as StrokeChunk[],
    histories: [] as DrawOp[][],
    word: null as string | null,
  };
  socket.on('draw:history', (ops) => log.histories.push(ops));
  socket.on('room:state', (st) => log.states.push(st));
  socket.on('chat:message', (m) => log.chat.push(m));
  socket.on('draw:chunk', (c) => log.chunks.push(c));
  socket.on('turn:word', ({ word }) => (log.word = word));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', reject);
  });
  return { socket, session: s, log };
}

function emit<T>(socket: ClientSocket, event: string, ...args: unknown[]): Promise<AckResponse<T>> {
  return new Promise((resolve) => {
    (socket.emit as (ev: string, ...a: unknown[]) => void)(event, ...args, (res: AckResponse<T>) => resolve(res));
  });
}

async function until<T>(fn: () => T | undefined | null | false, timeoutMs = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const latest = (log: { states: RoomState[] }) => log.states.at(-1);

describe('REST API', () => {
  it('reports health and issues guest sessions', async () => {
    const health = (await (await fetch(`${baseUrl}/api/health`)).json()) as { status: string; database: string };
    expect(health).toMatchObject({ status: 'ok', database: 'pglite' });
    const session = await newSession();
    const renewed = (await (
      await fetch(`${baseUrl}/api/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      })
    ).json()) as SessionInfo;
    expect(renewed.playerId).toBe(session.playerId);
  });

  it('requires a valid session for personal stats', async () => {
    expect((await fetch(`${baseUrl}/api/me/stats`)).status).toBe(401);
    const session = await newSession();
    const res = await fetch(`${baseUrl}/api/me/stats`, { headers: { authorization: `Bearer ${session.token}` } });
    expect(res.status).toBe(200);
  });
});

describe('Socket.IO multiplayer', () => {
  it('rejects connections without a valid session token', async () => {
    const socket: ClientSocket = connect(baseUrl, { auth: { token: 'forged' }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    const err = await new Promise<Error>((resolve) => socket.once('connect_error', resolve));
    expect(err.message).toBe('unauthorized');
  });

  it('creates a private room and lets a friend join with the code', async () => {
    const host = await client();
    const friend = await client();
    const created = await emit<{ code: string }>(host.socket, 'room:create', { nickname: 'Host', settings: { rounds: 1 } });
    expect(created.ok).toBe(true);
    const code = created.ok ? created.data.code : '';

    const bad = await emit(friend.socket, 'room:join', { code: 'ZZZZZZZZ', nickname: 'Friend' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const invalid = await emit(friend.socket, 'room:join', { code, nickname: 'x' });
    expect(invalid).toMatchObject({ ok: false, error: { code: 'bad-request' } });

    const joined = await emit(friend.socket, 'room:join', { code: code.toLowerCase(), nickname: 'Friend' });
    expect(joined.ok).toBe(true);
    const state = await until(() => latest(host.log)?.players.length === 2 && latest(host.log));
    expect(state.players.map((p) => p.nickname)).toEqual(['Host', 'Friend']);
    expect(state.hostId).toBe(host.session.playerId);

    const notHost = await emit(friend.socket, 'game:start');
    expect(notHost).toMatchObject({ ok: false, error: { code: 'not-host' } });
  });

  it('matches quick-play players into the same public room', async () => {
    const a = await client();
    const b = await client();
    const ra = await emit<{ code: string }>(a.socket, 'room:quickPlay', { nickname: 'Asha', language: 'ta' });
    const rb = await emit<{ code: string }>(b.socket, 'room:quickPlay', { nickname: 'Bala', language: 'ta' });
    expect(ra.ok && rb.ok && ra.data.code === rb.data.code).toBe(true);
    const state = await until(() => latest(b.log)?.autoStartInMs != null && latest(b.log));
    expect(state.visibility).toBe('public');
  });

  it('enforces drawing permissions, scores correct guesses and restores state on reconnect', async () => {
    const host = await client();
    const guest = await client();
    const created = await emit<{ code: string }>(host.socket, 'room:create', { nickname: 'Ann', settings: { rounds: 1 } });
    const code = created.ok ? created.data.code : '';
    await emit(guest.socket, 'room:join', { code, nickname: 'Ben' });
    expect((await emit(host.socket, 'game:start')).ok).toBe(true);

    const choosing = await until(() => latest(host.log)?.phase === 'choosing' && latest(host.log));
    const drawer = choosing.drawerId === host.session.playerId ? host : guest;
    const guesser = drawer === host ? guest : host;

    const wrong = await emit(guesser.socket, 'game:chooseWord', { index: 0 });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'not-drawer' } });
    expect((await emit(drawer.socket, 'game:chooseWord', { index: 0 })).ok).toBe(true);
    const word = await until(() => drawer.log.word);
    expect(guesser.log.word).toBeNull();
    const drawingState = await until(() => latest(guesser.log)?.phase === 'drawing' && latest(guesser.log));
    expect(JSON.stringify(drawingState)).not.toContain(`"${word}"`);

    // A guesser's strokes are ignored; the drawer's reach the guesser.
    const stroke = { id: 'stroke001', tool: 'pen', color: '#000000', size: 6, points: [100, 100, 200, 200], final: true };
    guesser.socket.emit('draw:chunk', { ...stroke, id: 'cheater01' } as StrokeChunk);
    drawer.socket.emit('draw:chunk', stroke as StrokeChunk);
    await until(() => guesser.log.chunks.length === 1);
    expect(guesser.log.chunks[0]!.id).toBe('stroke001');
    expect(drawer.log.chunks).toHaveLength(0);

    // Reconnecting with the same session restores room, drawing and chat.
    guesser.socket.disconnect();
    const back = await client(guesser.session);
    const history = await until(() => back.log.histories.at(-1));
    expect(history.map((op) => op.id)).toEqual(['stroke001']);
    await until(() => latest(back.log)?.code === code);

    // A wrong guess is broadcast, the right one is not.
    expect((await emit(back.socket, 'chat:send', { text: 'is it a tree' })).ok).toBe(true);
    expect((await emit(back.socket, 'chat:send', { text: word.toUpperCase() })).ok).toBe(true);
    const correct = await until(() => drawer.log.chat.find((m) => m.kind === 'correct'));
    expect(correct.text).toContain('guessed the word');
    expect(drawer.log.chat.some((m) => m.text === word.toUpperCase())).toBe(false);

    const afterGuess = await until(() => latest(drawer.log)?.phase === 'turnEnd' && latest(drawer.log));
    const guesserScore = afterGuess.players.find((p) => p.id === guesser.session.playerId)!.score;
    expect(guesserScore).toBeGreaterThan(0);
    expect(afterGuess.lastTurn).toMatchObject({ word, reason: 'all-guessed' });

    // Clients cannot set their own score: unknown fields are rejected.
    const cheat = await emit(back.socket, 'room:updateSettings', { score: 9999 });
    expect(cheat.ok).toBe(false);
  });

  it('lets the host kick a player, who is told why', async () => {
    const host = await client();
    const troll = await client();
    const created = await emit<{ code: string }>(host.socket, 'room:create', { nickname: 'Boss' });
    const code = created.ok ? created.data.code : '';
    await emit(troll.socket, 'room:join', { code, nickname: 'Troll' });
    const kicked = new Promise<{ reason: string }>((resolve) => troll.socket.once('room:kicked', resolve));
    expect((await emit(host.socket, 'mod:ban', { playerId: troll.session.playerId })).ok).toBe(true);
    expect((await kicked).reason).toMatch(/banned/);
    const retry = await emit(troll.socket, 'room:join', { code, nickname: 'Troll' });
    expect(retry).toMatchObject({ ok: false, error: { code: 'banned' } });
    const report = await emit(host.socket, 'mod:report', { playerId: troll.session.playerId, reason: 'spam' });
    expect(report).toMatchObject({ ok: false, error: { code: 'not-in-room' } });
  });
});

describe('Room browser', () => {
  it('creates named public/private rooms, lists them and joins by name', async () => {
    const owner = await client();
    const pub = await emit<{ code: string }>(owner.socket, 'room:create', {
      nickname: 'Owner',
      visibility: 'public',
      settings: { maxPlayers: 16 },
    });
    expect(pub.ok).toBe(true);
    const pubState = await until(() => latest(owner.log)?.visibility === 'public' && latest(owner.log));
    expect(pubState.name).toMatch(/^The \w+ Room\d*$/);
    expect(pubState.settings.maxPlayers).toBe(16);

    const host = await client();
    const bad = await emit(host.socket, 'room:create', { nickname: 'Host', name: '<b>x</b>' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    const priv = await emit<{ code: string }>(host.socket, 'room:create', { nickname: 'Host', name: 'Belfast Crew' });
    expect(priv.ok).toBe(true);

    const dir = (await (await fetch(`${baseUrl}/api/rooms`)).json()) as RoomDirectory;
    expect(dir.publicRooms.some((r) => r.name === pubState.name && r.maxPlayers === 16)).toBe(true);
    expect(dir.privateRooms.map((r) => r.name)).toContain('Belfast Crew');
    expect(dir.online).toBeGreaterThan(0);

    const friend = await client();
    const joined = await emit<{ code: string }>(friend.socket, 'room:joinByName', { name: 'belfast crew', nickname: 'Friend' });
    expect(joined.ok && priv.ok && joined.data.code === priv.data.code).toBe(true);
    const missing = await emit(friend.socket, 'room:joinByName', { name: 'Nope Room', nickname: 'Friend' });
    expect(missing).toMatchObject({ ok: false, error: { code: 'not-found' } });

    const reported = await emit(friend.socket, 'mod:reportRoom', { code: priv.ok ? priv.data.code : '' });
    expect(reported.ok).toBe(true);
    await server.persistence.flush();
    const rows = await db.query<{ reason: string; details: string }>('SELECT reason, details FROM reports');
    expect(rows.rows).toContainEqual({ reason: 'inappropriate-room-name', details: 'Belfast Crew' });
  });
});

describe('Persistence', () => {
  it('saves finished games, statistics, achievements and the leaderboard', async () => {
    server.persistence.recordGame({
      sessionId: '9d0f3a52-6a8a-4a5e-9a51-6d1f1f0b2c11',
      roomCode: 'ABCDEFGH',
      visibility: 'private',
      language: 'en',
      totalRounds: 1,
      drawTime: 60,
      completed: true,
      startedAt: new Date(Date.now() - 60_000),
      endedAt: new Date(),
      turns: [
        {
          round: 1,
          turnNumber: 1,
          drawerId: '11111111-1111-4111-8111-111111111111',
          wordId: null,
          wordText: 'cat',
          correctGuesses: 1,
          endReason: 'all-guessed',
          startedAt: new Date(Date.now() - 30_000),
          endedAt: new Date(),
        },
      ],
      players: [
        { playerId: '11111111-1111-4111-8111-111111111111', nickname: 'Winner', finalScore: 1200, rank: 1, correctGuesses: 0, drawings: 1, isWinner: true },
        { playerId: '22222222-2222-4222-8222-222222222222', nickname: 'Second', finalScore: 150, rank: 2, correctGuesses: 1, drawings: 0, isWinner: false },
      ],
    });
    await server.persistence.flush();

    const board = (await (await fetch(`${baseUrl}/api/leaderboard`)).json()) as { entries: { nickname: string }[] };
    expect(board.entries.map((e) => e.nickname)).toEqual(['Winner', 'Second']);

    const stats = await server.persistence.playerStats('11111111-1111-4111-8111-111111111111');
    expect(stats).toMatchObject({ gamesPlayed: 1, wins: 1, totalScore: 1200, bestScore: 1200 });
    const earned = stats!.achievements.filter((a) => a.earnedAt).map((a) => a.code);
    expect(earned.sort()).toEqual(['FIRST_GAME', 'FIRST_WIN', 'HIGH_SCORER']);
  });
});
