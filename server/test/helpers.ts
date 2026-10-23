import { DEFAULT_SETTINGS, type RoomSettings, type RoomVisibility, type ServerEventName } from '@dws/shared';
import type { GameSummary, WordEntry } from '../src/models/game-records.js';
import { Room, type RoomOutput } from '../src/models/room.js';
import { WordService } from '../src/services/word.service.js';

export const P1 = '11111111-1111-4111-8111-111111111111';
export const P2 = '22222222-2222-4222-8222-222222222222';
export const P3 = '33333333-3333-4333-8333-333333333333';
export const P4 = '44444444-4444-4444-8444-444444444444';

export const TEST_WORDS: WordEntry[] = [
  { id: 1, text: 'banana', difficulty: 'easy', category: 'food', language: 'en' },
  { id: 2, text: 'giraffe', difficulty: 'medium', category: 'animals', language: 'en' },
  { id: 3, text: 'hot dog', difficulty: 'hard', category: 'food', language: 'en' },
  { id: 4, text: 'yellow', difficulty: 'easy', category: 'objects', language: 'en' },
  { id: 5, text: 'யானை', difficulty: 'easy', category: 'animals', language: 'ta' },
];

export interface SentEvent {
  to: 'all' | string[];
  except?: string;
  event: ServerEventName;
  payload: unknown;
}

/** A Room wired to an in-memory output so tests can inspect everything it sends. */
export function createRoomHarness(visibility: RoomVisibility = 'private', settings: Partial<RoomSettings> = {}) {
  const sent: SentEvent[] = [];
  const removed: { playerId: string; reason: string | null }[] = [];
  const games: GameSummary[] = [];
  const output: RoomOutput = {
    toAll(event, payload, except) {
      sent.push({ to: 'all', event, payload, except });
    },
    toPlayers(ids, event, payload) {
      sent.push({ to: [...ids], event, payload });
    },
    playerRemoved(playerId, reason) {
      removed.push({ playerId, reason });
    },
  };
  const room = new Room('ABCDEFGH', visibility, { ...DEFAULT_SETTINGS, ...settings }, {
    words: new WordService(TEST_WORDS),
    output,
    hooks: { onGameEnd: (s) => games.push(s) },
  });

  /** Events a given player would have received. */
  const receivedBy = (playerId: string, event?: ServerEventName) =>
    sent.filter(
      (e) =>
        (e.to === 'all' ? e.except !== playerId : e.to.includes(playerId)) && (event === undefined || e.event === event),
    );

  return { room, sent, removed, games, receivedBy };
}

/** Lets queued microtasks (coalesced state broadcasts) run. */
export const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));
