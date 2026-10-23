import {
  DEFAULT_SETTINGS,
  isValidRoomCode,
  normalizeRoomCode,
  roomNameKey,
  type Language,
  type RoomDirectory,
  type RoomListing,
  type RoomSettings,
  type RoomVisibility,
} from '@dws/shared';
import { Room, type RoomHooks, type RoomOutput } from '../models/room.js';
import { GameError } from '../utils/errors.js';
import { generateRoomCode, pickRandom } from '../utils/ids.js';
import type { Logger } from '../utils/logger.js';
import type { WordService } from './word.service.js';

export interface RoomManagerDeps {
  words: WordService;
  logger: Logger;
  /** Builds the output adapter for a room (the Socket.IO layer provides this). */
  createOutput(code: string): RoomOutput;
  hooks?: Omit<RoomHooks, 'onEmpty'>;
  maxRooms?: number;
}

export interface CreateRoomOptions {
  /** Custom display name; a random "The ___ Room" name is used when omitted. */
  name?: string;
  /** Private rooms: show in the private room list. */
  listed?: boolean;
  creatorId?: string | null;
}

const NAME_WORDS = [
  'Butterfly', 'Kitten', 'Sloth', 'Artistic', 'Sunny', 'Octopus', 'Merry', 'Rabbit', 'Panda', 'Rainbow',
  'Doodle', 'Mango', 'Cosmic', 'Jolly', 'Giggle', 'Pencil', 'Crayon', 'Koala', 'Penguin', 'Dolphin',
  'Peacock', 'Lotus', 'Comet', 'Bubble', 'Tiger', 'Parrot', 'Cupcake', 'Sparkle', 'Happy', 'Smiley',
  'Sketchy', 'Breezy', 'Coconut', 'Firefly', 'Marshmallow', 'Otter', 'Pixel', 'Starfish', 'Toucan', 'Zebra',
];

/** Lists show at most this many rooms of each kind. */
const LIST_LIMIT = 100;

/**
 * Owns every room on this server instance. State is in memory, so it only works
 * for a single instance; see docs/ARCHITECTURE.md for scaling out.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly names = new Map<string, string>(); // name key -> code
  private readonly playerRooms = new Map<string, string>();
  private readonly maxRooms: number;

  constructor(private readonly deps: RoomManagerDeps) {
    this.maxRooms = deps.maxRooms ?? 500;
  }

  create(visibility: RoomVisibility, settings: RoomSettings = DEFAULT_SETTINGS, options: CreateRoomOptions = {}): Room {
    if (this.rooms.size >= this.maxRooms) {
      throw new GameError('rate-limited', 'The server is busy right now. Please try again in a minute.');
    }
    let name: string;
    if (options.name) {
      if (this.names.has(roomNameKey(options.name))) {
        throw new GameError('bad-request', 'A room with that name already exists. Please pick another name.');
      }
      name = options.name;
    } else {
      name = this.randomName();
    }
    let code = generateRoomCode();
    for (let attempt = 0; this.rooms.has(code); attempt++) {
      if (attempt > 20) throw new GameError('server-error', 'Could not create a room. Please try again.');
      code = generateRoomCode();
    }
    const room = new Room(
      code,
      visibility,
      { ...settings, categories: [...settings.categories] },
      {
        words: this.deps.words,
        output: this.deps.createOutput(code),
        hooks: {
          ...this.deps.hooks,
          onEmpty: (r) => {
            this.forgetRoom(r);
            this.deps.logger.debug('Room closed', { code: r.code });
          },
        },
      },
      { name, listed: visibility === 'public' ? true : (options.listed ?? true), creatorId: options.creatorId ?? null },
    );
    this.rooms.set(code, room);
    this.names.set(roomNameKey(name), code);
    this.deps.logger.debug('Room created', { code, visibility, name });
    return room;
  }

  get(code: string): Room | undefined {
    const room = this.rooms.get(code);
    return room && !room.isDisposed ? room : undefined;
  }

  /**
   * Finds a room by display name (case-insensitive) or by exact room code.
   * Unlisted private rooms are only reachable by code or invite link.
   */
  findByNameOrCode(input: string): Room | undefined {
    const code = normalizeRoomCode(input);
    if (isValidRoomCode(code)) {
      const byCode = this.get(code);
      if (byCode) return byCode;
    }
    const byNameCode = this.names.get(roomNameKey(input));
    const room = byNameCode ? this.get(byNameCode) : undefined;
    return room && (room.visibility === 'public' || room.listed) ? room : undefined;
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRooms.get(playerId);
    const room = code ? this.get(code) : undefined;
    if (room?.hasPlayer(playerId)) return room;
    if (code) this.playerRooms.delete(playerId);
    return undefined;
  }

  /**
   * Quick-play matchmaking: a public room in the player's language with space.
   * Prefers fuller rooms where people are waiting or playing an early round.
   */
  findPublicRoom(language: Language, playerId: string): Room | undefined {
    let best: Room | undefined;
    let bestScore = -Infinity;
    for (const room of this.rooms.values()) {
      if (room.visibility !== 'public' || room.settings.language !== language || !room.canAccept(playerId)) continue;
      if (room.size >= room.settings.maxPlayers || room.phase === 'gameEnd') continue;
      const roundsLeft = room.phase === 'lobby' ? room.settings.rounds : room.settings.rounds - room.currentRound;
      const score = room.connectedCount * 10 + roundsLeft * 3 + (room.phase === 'lobby' ? 5 : 0);
      if (score > bestScore) {
        best = room;
        bestScore = score;
      }
    }
    return best;
  }

  /** Joins a room, leaving any other room first. */
  join(room: Room, playerId: string, nickname: string): 'joined' | 'rejoined' {
    const current = this.roomOf(playerId);
    if (current && current !== room) {
      room.assertCanJoin(playerId); // validate before leaving the old room
      current.removePlayer(playerId, 'left');
    }
    const result = room.join(playerId, nickname);
    this.playerRooms.set(playerId, room.code);
    return result;
  }

  leave(playerId: string): Room | undefined {
    const room = this.roomOf(playerId);
    room?.removePlayer(playerId, 'left');
    this.playerRooms.delete(playerId);
    return room;
  }

  /** Called by the output adapter when a room removes a player. */
  forget(playerId: string, code: string): void {
    if (this.playerRooms.get(playerId) === code) this.playerRooms.delete(playerId);
  }

  /** Removes a room that was never used (e.g. its creator failed to join). */
  discard(room: Room): void {
    room.dispose();
    this.forgetRoom(room);
  }

  /** Room browser data. Unlisted rooms are counted but never shown. */
  directory(online: number): RoomDirectory {
    const publicRooms: RoomListing[] = [];
    const privateRooms: RoomListing[] = [];
    const totals = { publicRooms: 0, publicPlayers: 0, privateRooms: 0, privatePlayers: 0 };
    for (const room of this.rooms.values()) {
      if (room.isDisposed || room.size === 0) continue;
      if (room.visibility === 'public') {
        totals.publicRooms++;
        totals.publicPlayers += room.connectedCount;
        if (room.listed) publicRooms.push(listing(room));
      } else {
        totals.privateRooms++;
        totals.privatePlayers += room.connectedCount;
        if (room.listed) privateRooms.push(listing(room));
      }
    }
    publicRooms.sort((a, b) => b.players - a.players || a.name.localeCompare(b.name));
    privateRooms.sort((a, b) => a.name.localeCompare(b.name));
    return { publicRooms: publicRooms.slice(0, LIST_LIMIT), privateRooms: privateRooms.slice(0, LIST_LIMIT), totals, online };
  }

  stats(): { rooms: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.connectedCount;
    return { rooms: this.rooms.size, players };
  }

  shutdown(): void {
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.names.clear();
    this.playerRooms.clear();
  }

  private forgetRoom(room: Room): void {
    this.rooms.delete(room.code);
    if (this.names.get(roomNameKey(room.name)) === room.code) this.names.delete(roomNameKey(room.name));
  }

  /** "The Kitten Room", or "The Kitten Room2" when taken. */
  private randomName(): string {
    for (let attempt = 0; attempt < 10; attempt++) {
      const base = `The ${pickRandom(NAME_WORDS)} Room`;
      for (let n = 1; n < 50; n++) {
        const candidate = n === 1 ? base : `${base}${n}`;
        if (!this.names.has(roomNameKey(candidate))) return candidate;
      }
    }
    return `Room ${generateRoomCode()}`;
  }
}

function listing(room: Room): RoomListing {
  return {
    code: room.code,
    name: room.name,
    visibility: room.visibility,
    players: room.connectedCount,
    maxPlayers: room.settings.maxPlayers,
    language: room.settings.language,
    phase: room.phase,
    round: room.currentRound,
    totalRounds: room.settings.rounds,
  };
}
