import { describe, expect, it } from 'vitest';
import { LIMITS } from '@dws/shared';
import {
  chatSchema,
  createRoomSchema,
  joinRoomSchema,
  parsePayload,
  reportSchema,
  settingsSchema,
  strokeChunkSchema,
} from '../src/sockets/schemas.js';
import { GameError } from '../src/utils/errors.js';

const validChunk = { id: 'abcdef12', tool: 'pen', color: '#000000', size: 6, points: [0, 0, 10_000, 10_000], final: false };

describe('payload validation', () => {
  it('accepts and normalises valid room payloads', () => {
    expect(parsePayload(joinRoomSchema, { code: 'abcd-efgh', nickname: '  Smiley  ' })).toEqual({
      code: 'ABCDEFGH',
      nickname: 'Smiley',
    });
    expect(parsePayload(createRoomSchema, { nickname: 'மது', settings: { rounds: 2, language: 'ta' } }).settings).toEqual({
      rounds: 2,
      language: 'ta',
    });
  });

  it('rejects bad nicknames, codes and unknown fields', () => {
    expect(() => parsePayload(joinRoomSchema, { code: 'abc', nickname: 'Smiley' })).toThrow(GameError);
    expect(() => parsePayload(joinRoomSchema, { code: 'ABCDEFGH', nickname: '<img onerror=x>' })).toThrow(/Nickname/);
    expect(() => parsePayload(joinRoomSchema, { code: 'ABCDEFGH', nickname: 'shit' })).toThrow(/friendlier/);
    expect(() => parsePayload(settingsSchema, { rounds: 99 })).toThrow(GameError);
    expect(() => parsePayload(settingsSchema, { isAdmin: true })).toThrow(GameError);
    expect(() => parsePayload(settingsSchema, { categories: ['weapons'] })).toThrow(GameError);
    expect(() => parsePayload(joinRoomSchema, null)).toThrow(GameError);
  });

  it('validates stroke chunks strictly', () => {
    expect(parsePayload(strokeChunkSchema, validChunk)).toEqual(validChunk);
    const bad = [
      { ...validChunk, color: 'red' },
      { ...validChunk, size: 7 },
      { ...validChunk, points: [1, 2, 3] },
      { ...validChunk, points: [1.5, 2] },
      { ...validChunk, points: [-1, 2] },
      { ...validChunk, points: [10_001, 2] },
      { ...validChunk, points: Array(LIMITS.CHUNK_MAX_POINTS * 2 + 2).fill(1) },
      { ...validChunk, id: 'x' },
      { ...validChunk, extra: 1 },
    ];
    for (const payload of bad) expect(() => parsePayload(strokeChunkSchema, payload)).toThrow(GameError);
  });

  it('validates chat and reports', () => {
    expect(() => parsePayload(chatSchema, { text: '' })).toThrow(GameError);
    expect(() => parsePayload(chatSchema, { text: 'x'.repeat(1000) })).toThrow(GameError);
    expect(parsePayload(reportSchema, { playerId: '11111111-1111-4111-8111-111111111111', reason: 'spam' }).reason).toBe('spam');
    expect(() => parsePayload(reportSchema, { playerId: 'nope', reason: 'spam' })).toThrow(GameError);
    expect(() => parsePayload(reportSchema, { playerId: '11111111-1111-4111-8111-111111111111', reason: 'boring' })).toThrow(
      GameError,
    );
  });
});
