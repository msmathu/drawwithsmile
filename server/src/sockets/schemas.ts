import { z } from 'zod';
import {
  BRUSH_SIZES,
  CATEGORY_SLUGS,
  LIMITS,
  PALETTE,
  REPORT_REASONS,
  SETTINGS_BOUNDS,
  WORD_CHOICE_COUNT,
  cleanText,
  isValidNickname,
  isValidRoomCode,
  isValidRoomName,
  normalizeRoomCode,
  sanitizeNickname,
  sanitizeRoomName,
} from '@dws/shared';
import { GameError } from '../utils/errors.js';
import { containsProfanity } from '../utils/profanity.js';

/** Every client payload is parsed with one of these schemas before use. */

const nickname = z
  .string()
  .max(64)
  .transform(sanitizeNickname)
  .refine(isValidNickname, `Nickname must be ${LIMITS.NICKNAME_MIN}–${LIMITS.NICKNAME_MAX} letters, numbers, spaces, _ . or -`)
  .refine((n) => !containsProfanity(n), 'Please choose a friendlier nickname.');

const language = z.enum(['en', 'ta']);

const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const settingsSchema = z
  .object({
    drawTime: int(SETTINGS_BOUNDS.drawTime.min, SETTINGS_BOUNDS.drawTime.max),
    rounds: int(SETTINGS_BOUNDS.rounds.min, SETTINGS_BOUNDS.rounds.max),
    language,
    difficulty: z.enum(['easy', 'medium', 'hard', 'mixed']),
    maxPlayers: int(SETTINGS_BOUNDS.maxPlayers.min, SETTINGS_BOUNDS.maxPlayers.max),
    categories: z
      .array(z.enum(CATEGORY_SLUGS as [string, ...string[]]))
      .max(CATEGORY_SLUGS.length)
      .transform((list) => [...new Set(list)]),
  })
  .partial()
  .strict();

export const quickPlaySchema = z.object({ nickname, language });

const roomName = z
  .string()
  .max(80)
  .transform(sanitizeRoomName)
  .refine(isValidRoomName, `Room name must be ${LIMITS.ROOM_NAME_MIN}–${LIMITS.ROOM_NAME_MAX} letters, numbers or spaces.`)
  .refine((n) => !containsProfanity(n), 'Please choose a friendlier room name.');

export const createRoomSchema = z.object({
  nickname,
  visibility: z.enum(['public', 'private']).default('private'),
  name: roomName.optional(),
  listed: z.boolean().default(true),
  settings: settingsSchema.optional(),
});

export const joinByNameSchema = z.object({
  name: z
    .string()
    .max(80)
    .transform(sanitizeRoomName)
    .refine((n) => n.length > 0, 'Enter a room name or code.'),
  nickname,
});

export const roomCodeSchema = z.object({
  code: z.string().max(20).transform(normalizeRoomCode).refine(isValidRoomCode, 'That room code is not valid.'),
});

export const joinRoomSchema = z.object({
  code: z.string().max(20).transform(normalizeRoomCode).refine(isValidRoomCode, 'That room code is not valid.'),
  nickname,
});

export const chooseWordSchema = z.object({ index: int(0, WORD_CHOICE_COUNT - 1) });

export const strokeChunkSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{6,24}$/),
    tool: z.enum(['pen', 'eraser']),
    color: z.enum(PALETTE),
    size: z.number().refine((s) => (BRUSH_SIZES as readonly number[]).includes(s), 'Invalid brush size'),
    points: z
      .array(int(0, LIMITS.COORD_MAX))
      .min(2)
      .max(LIMITS.CHUNK_MAX_POINTS * 2)
      .refine((p) => p.length % 2 === 0, 'Points must be x/y pairs'),
    final: z.boolean(),
  })
  .strict();

export const chatSchema = z.object({ text: z.string().min(1).max(LIMITS.CHAT_MAX * 3) });

export const playerTargetSchema = z.object({ playerId: z.uuid() });

export const muteSchema = z.object({ playerId: z.uuid(), muted: z.boolean() });

export const reportSchema = z.object({
  playerId: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z
    .string()
    .max(LIMITS.REPORT_DETAILS_MAX * 2)
    .transform((d) => cleanText(d).slice(0, LIMITS.REPORT_DETAILS_MAX))
    .optional(),
});

export function parsePayload<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new GameError('bad-request', result.error.issues[0]?.message ?? 'Invalid request.');
  }
  return result.data;
}
