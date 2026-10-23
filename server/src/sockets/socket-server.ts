import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import {
  DEFAULT_SETTINGS,
  LIMITS,
  type Ack,
  type ClientToServerEvents,
  type ServerEventName,
  type ServerEventPayload,
  type ServerToClientEvents,
} from '@dws/shared';
import type { AppConfig } from '../config/env.js';
import type { RoomOutput } from '../models/room.js';
import type { Room } from '../models/room.js';
import type { PersistenceService } from '../services/persistence.service.js';
import { RoomManager } from '../services/room-manager.js';
import type { SessionService } from '../services/session.service.js';
import type { WordService } from '../services/word.service.js';
import { GameError, toErrorPayload } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rate-limiter.js';
import { clientIp, isAllowedOrigin } from '../utils/network.js';
import {
  chatSchema,
  chooseWordSchema,
  createRoomSchema,
  joinByNameSchema,
  joinRoomSchema,
  muteSchema,
  parsePayload,
  playerTargetSchema,
  quickPlaySchema,
  reportSchema,
  roomCodeSchema,
  settingsSchema,
  strokeChunkSchema,
} from './schemas.js';

interface SocketData {
  playerId: string;
  ip: string;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketContext {
  config: AppConfig;
  logger: Logger;
  sessions: SessionService;
  words: WordService;
  persistence: PersistenceService;
}

const channel = (code: string) => `room:${code}`;
const noop = () => undefined;

/** Limits per key. Tuned for humans; scripts flooding the server get dropped. */
function createLimiters(roomActionBurst: number) {
  return {
    rooms: new RateLimiter(roomActionBurst, 1 / 3), // create/join/quick play per IP
    draw: new RateLimiter(120, 60), // stroke chunks per player
    drawActions: new RateLimiter(10, 3), // undo/redo/clear per player
    chat: new RateLimiter(5, 1), // messages per player
    moderation: new RateLimiter(5, 0.1),
    reports: new RateLimiter(3, 1 / 60),
    lobby: new RateLimiter(10, 1), // start/settings/choose per player
  };
}

export interface SocketLayer {
  io: IoServer;
  rooms: RoomManager;
  close(): Promise<void>;
}

export function attachSocketServer(httpServer: HttpServer, ctx: SocketContext): SocketLayer {
  const { config, logger } = ctx;
  const io: IoServer = new Server(httpServer, {
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.clientOrigins)),
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: LIMITS.MAX_PAYLOAD_BYTES,
    pingInterval: 20_000,
    pingTimeout: 20_000,
    connectionStateRecovery: undefined,
  });

  const presence = new Map<string, string>(); // playerId -> socket id
  const connectionsPerIp = new Map<string, number>();
  const limiters = createLimiters(config.roomActionBurst);
  const lastResync = new Map<string, number>();

  const emitTo = <E extends ServerEventName>(
    target: { emit: (event: E, payload: ServerEventPayload<E>) => unknown },
    event: E,
    payload: ServerEventPayload<E>,
  ) => target.emit(event, payload);

  const createOutput = (code: string): RoomOutput => ({
    toAll(event, payload, exceptPlayerId) {
      const exceptSocket = exceptPlayerId ? presence.get(exceptPlayerId) : undefined;
      const target = exceptSocket ? io.to(channel(code)).except(exceptSocket) : io.to(channel(code));
      emitTo(target as never, event, payload);
    },
    toPlayers(playerIds, event, payload) {
      for (const id of playerIds) {
        const socketId = presence.get(id);
        if (socketId) emitTo(io.to(socketId) as never, event, payload);
      }
    },
    playerRemoved(playerId, kickReason) {
      rooms.forget(playerId, code);
      const socketId = presence.get(playerId);
      if (!socketId) return;
      io.in(socketId).socketsLeave(channel(code));
      if (kickReason) io.to(socketId).emit('room:kicked', { reason: kickReason });
    },
  });

  const rooms = new RoomManager({
    words: ctx.words,
    logger,
    createOutput,
    hooks: {
      onGameEnd: (summary) => ctx.persistence.recordGame(summary),
      onModeration: (action) => ctx.persistence.recordModeration(action),
    },
  });

  const pruneTimer = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.prune();
  }, 60_000);
  pruneTimer.unref();

  // ------------------------------------------------------------ authentication
  io.use((socket, next) => {
    const playerId = ctx.sessions.verify((socket.handshake.auth as { token?: unknown } | undefined)?.token);
    if (!playerId) return next(new Error('unauthorized'));
    const ip = clientIp(socket.handshake.headers['x-forwarded-for'], socket.handshake.address, config.trustProxy);
    if ((connectionsPerIp.get(ip) ?? 0) >= config.maxConnectionsPerIp) return next(new Error('too-many-connections'));
    socket.data = { playerId, ip };
    next();
  });

  io.on('connection', (socket: IoSocket) => {
    const { playerId, ip } = socket.data;
    connectionsPerIp.set(ip, (connectionsPerIp.get(ip) ?? 0) + 1);

    // One live connection per player: a new tab/device replaces the old one.
    const previous = presence.get(playerId);
    presence.set(playerId, socket.id);
    if (previous && previous !== socket.id) {
      const old = io.sockets.sockets.get(previous);
      old?.emit('session:replaced', { message: 'You opened DrawWithSmile somewhere else.' });
      old?.disconnect(true);
    }

    // Automatic rejoin after a page refresh or network drop.
    const existing = rooms.roomOf(playerId);
    if (existing) {
      void socket.join(channel(existing.code));
      existing.reconnect(playerId);
      existing.syncPlayer(playerId);
    }

    registerHandlers(socket);

    socket.on('disconnect', () => {
      const count = (connectionsPerIp.get(ip) ?? 1) - 1;
      if (count <= 0) connectionsPerIp.delete(ip);
      else connectionsPerIp.set(ip, count);
      if (presence.get(playerId) !== socket.id) return;
      presence.delete(playerId);
      rooms.roomOf(playerId)?.markDisconnected(playerId);
      limiters.draw.delete(playerId);
      lastResync.delete(playerId);
    });
  });

  // ------------------------------------------------------------ handlers
  function respond<T>(socket: IoSocket, ack: unknown, fn: () => T): void {
    const cb = (typeof ack === 'function' ? ack : noop) as Ack<T>;
    try {
      cb({ ok: true, data: fn() });
    } catch (err) {
      if (!(err instanceof GameError)) {
        logger.error('Socket handler failed', { err, playerId: socket.data.playerId });
      }
      cb({ ok: false, error: toErrorPayload(err) });
    }
  }

  function limit(limiter: RateLimiter, key: string, message = 'You are doing that too often. Please slow down.'): void {
    if (!limiter.take(key)) throw new GameError('rate-limited', message);
  }

  function currentRoom(playerId: string): Room {
    const room = rooms.roomOf(playerId);
    if (!room) throw new GameError('not-in-room', 'You are not in a room.');
    return room;
  }

  function enterRoom(socket: IoSocket, room: Room, nickname: string): { code: string } {
    const { playerId } = socket.data;
    const previous = rooms.roomOf(playerId);
    rooms.join(room, playerId, nickname);
    if (previous && previous !== room) void socket.leave(channel(previous.code));
    void socket.join(channel(room.code));
    room.syncPlayer(playerId);
    return { code: room.code };
  }

  /** Drawing events have no ack; rejected input from the drawer triggers a resync. */
  function drawing(socket: IoSocket, fn: (room: Room) => void): void {
    const { playerId } = socket.data;
    const room = rooms.roomOf(playerId);
    if (!room) return;
    try {
      fn(room);
    } catch (err) {
      if (!room.isDrawer(playerId)) return;
      const now = Date.now();
      if (now - (lastResync.get(playerId) ?? 0) < 1_000) return;
      lastResync.set(playerId, now);
      socket.emit('notice', toErrorPayload(err));
      socket.emit('draw:history', room.drawHistory());
    }
  }

  function registerHandlers(socket: IoSocket): void {
    const { playerId, ip } = socket.data;

    socket.on('room:quickPlay', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.rooms, ip);
        const { nickname, language } = parsePayload(quickPlaySchema, payload);
        const current = rooms.roomOf(playerId);
        if (current?.visibility === 'public' && current.settings.language === language) {
          return enterRoom(socket, current, nickname);
        }
        const room = rooms.findPublicRoom(language, playerId) ?? rooms.create('public', { ...DEFAULT_SETTINGS, language });
        return enterRoom(socket, room, nickname);
      }),
    );

    socket.on('room:create', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.rooms, ip);
        const { nickname, visibility, name, listed, settings } = parsePayload(createRoomSchema, payload);
        const room = rooms.create(visibility, { ...DEFAULT_SETTINGS, ...settings }, { name, listed, creatorId: playerId });
        try {
          return enterRoom(socket, room, nickname);
        } catch (err) {
          if (room.size === 0) rooms.discard(room);
          throw err;
        }
      }),
    );

    socket.on('room:join', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.rooms, ip, 'Too many join attempts. Please wait a minute.');
        const { code, nickname } = parsePayload(joinRoomSchema, payload);
        const room = rooms.get(code);
        if (!room) throw new GameError('not-found', 'No room with that code. Check the code and try again.');
        return enterRoom(socket, room, nickname);
      }),
    );

    socket.on('room:joinByName', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.rooms, ip, 'Too many join attempts. Please wait a minute.');
        const { name, nickname } = parsePayload(joinByNameSchema, payload);
        const room = rooms.findByNameOrCode(name);
        if (!room) throw new GameError('not-found', 'No room with that name or code. Check the spelling and try again.');
        return enterRoom(socket, room, nickname);
      }),
    );

    socket.on('room:leave', (ack) =>
      respond(socket, ack, () => {
        const room = rooms.leave(playerId);
        if (room) void socket.leave(channel(room.code));
        return null;
      }),
    );

    socket.on('room:updateSettings', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.lobby, playerId);
        currentRoom(playerId).updateSettings(playerId, parsePayload(settingsSchema, payload));
        return null;
      }),
    );

    socket.on('game:start', (ack) =>
      respond(socket, ack, () => {
        limit(limiters.lobby, playerId);
        currentRoom(playerId).startGame(playerId);
        return null;
      }),
    );

    socket.on('game:chooseWord', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.lobby, playerId);
        currentRoom(playerId).chooseWord(playerId, parsePayload(chooseWordSchema, payload).index);
        return null;
      }),
    );

    socket.on('game:backToLobby', (ack) =>
      respond(socket, ack, () => {
        limit(limiters.lobby, playerId);
        currentRoom(playerId).backToLobby(playerId);
        return null;
      }),
    );

    socket.on('draw:chunk', (payload) =>
      drawing(socket, (room) => {
        if (!limiters.draw.take(playerId)) throw new GameError('rate-limited', 'Drawing too fast.');
        room.drawChunk(playerId, parsePayload(strokeChunkSchema, payload));
      }),
    );
    socket.on('draw:undo', () =>
      drawing(socket, (room) => {
        if (limiters.drawActions.take(playerId)) room.undo(playerId);
      }),
    );
    socket.on('draw:redo', () =>
      drawing(socket, (room) => {
        if (limiters.drawActions.take(playerId)) room.redo(playerId);
      }),
    );
    socket.on('draw:clear', () =>
      drawing(socket, (room) => {
        if (limiters.drawActions.take(playerId)) room.clear(playerId);
      }),
    );

    socket.on('chat:send', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.chat, playerId, 'You are sending messages too quickly.');
        currentRoom(playerId).handleChat(playerId, parsePayload(chatSchema, payload).text);
        return null;
      }),
    );

    socket.on('mod:kick', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.moderation, playerId);
        currentRoom(playerId).kick(playerId, parsePayload(playerTargetSchema, payload).playerId, false);
        return null;
      }),
    );

    socket.on('mod:ban', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.moderation, playerId);
        currentRoom(playerId).kick(playerId, parsePayload(playerTargetSchema, payload).playerId, true);
        return null;
      }),
    );

    socket.on('mod:mute', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.moderation, playerId);
        const { playerId: target, muted } = parsePayload(muteSchema, payload);
        currentRoom(playerId).setMuted(playerId, target, muted);
        return null;
      }),
    );

    socket.on('mod:voteKick', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.moderation, playerId);
        currentRoom(playerId).voteKick(playerId, parsePayload(playerTargetSchema, payload).playerId);
        return null;
      }),
    );

    socket.on('mod:reportRoom', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.reports, playerId, 'You have sent several reports recently. Please wait a little.');
        const room = rooms.get(parsePayload(roomCodeSchema, payload).code);
        if (!room) throw new GameError('not-found', 'That room no longer exists.');
        if (room.reportName(playerId) && room.creatorId && room.creatorId !== playerId) {
          ctx.persistence.recordReport({
            reporterId: playerId,
            reportedId: room.creatorId,
            reportedNickname: room.playerNickname(room.creatorId) ?? '(left)',
            roomCode: room.code,
            reason: 'inappropriate-room-name',
            details: room.name,
          });
        }
        return null;
      }),
    );

    socket.on('mod:report', (payload, ack) =>
      respond(socket, ack, () => {
        limit(limiters.reports, playerId, 'You have sent several reports recently. Please wait a little.');
        const report = parsePayload(reportSchema, payload);
        if (report.playerId === playerId) throw new GameError('bad-request', 'You cannot report yourself.');
        const room = currentRoom(playerId);
        const nickname = room.playerNickname(report.playerId);
        if (!nickname) throw new GameError('not-in-room', 'That player is not in this room.');
        ctx.persistence.recordReport({
          reporterId: playerId,
          reportedId: report.playerId,
          reportedNickname: nickname,
          roomCode: room.code,
          reason: report.reason,
          details: report.details,
        });
        return null;
      }),
    );
  }

  return {
    io,
    rooms,
    async close() {
      clearInterval(pruneTimer);
      rooms.shutdown();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

export function onlineCount(layer: SocketLayer): number {
  return layer.io.engine.clientsCount;
}
