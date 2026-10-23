import { randomBytes, randomInt } from 'node:crypto';
import { LIMITS, ROOM_CODE_ALPHABET } from '@dws/shared';

/** Cryptographically random room code, e.g. "K7QM2XPA". */
export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < LIMITS.ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Short random id for chat messages and server-created drawing ops. */
export function shortId(): string {
  return randomBytes(9).toString('base64url');
}

export function pickRandom<T>(items: readonly T[]): T | undefined {
  return items.length ? items[randomInt(items.length)] : undefined;
}

export function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}
