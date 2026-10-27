import { describe, expect, it } from 'vitest';
import { LIMITS } from '@dws/shared';
import {
  chatSchema,
  createRoomSchema,
  fillSchema,
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

  it('validates fills strictly', () => {
    const fill = { id: 'abcdef12', color: '#facc15', x: 10, y: 10_000 };
    expect(parsePayload(fillSchema, fill)).toEqual(fill);
    for (const bad of [
      { ...fill, color: '#123456' },
      { ...fill, x: -1 },
      { ...fill, y: 10_001 },
      { ...fill, x: 1.5 },
      { ...fill, id: 'x' },
      { ...fill, kind: 'fill' },
    ]) {
      expect(() => parsePayload(fillSchema, bad)).toThrow(GameError);
    }
  });

  it('only accepts the offered temporary ban lengths', async () => {
    const { banSchema } = await import('../src/sockets/schemas.js');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parsePayload(banSchema, { playerId: id, minutes: 5 })).toEqual({ playerId: id, minutes: 5 });
    expect(parsePayload(banSchema, { playerId: id, minutes: 30 }).minutes).toBe(30);
    for (const bad of [{ playerId: id }, { playerId: id, minutes: 0 }, { playerId: id, minutes: 99999 }, { playerId: id, minutes: 7 }]) {
      expect(() => parsePayload(banSchema, bad)).toThrow(GameError);
    }
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

describe('room rule validation', () => {
  it('accepts every new rule within range', async () => {
    const { settingsSchema } = await import('../src/sockets/schemas.js');
    const rules = {
      language: 'mixed', hints: false, lateJoin: false, mode: 'chaos', chaosRules: ['one-stroke', 'one-stroke'],
      chaosRandom: false, collaborative: true, artistCount: 3, artistSeconds: 20, reactions: true, voting: true,
      votingSeconds: 15, voteBonus: 0, teams: false, teamCount: 3, teamAssignment: 'manual', teamScoring: 'average', teamBonus: 100,
    };
    expect(parsePayload(settingsSchema, rules)).toMatchObject({ ...rules, chaosRules: ['one-stroke'] });
  });

  it('rejects out-of-range or unknown rule values', async () => {
    const { settingsSchema, voteSchema, reactionSchema, teamSchema } = await import('../src/sockets/schemas.js');
    for (const bad of [
      { artistCount: 1 }, { artistSeconds: 5 }, { votingSeconds: 100 }, { voteBonus: -1 }, { teamCount: 5 },
      { teamBonus: 500 }, { mode: 'turbo' }, { chaosRules: ['rainbow'] }, { language: 'fr' }, { teamAssignment: 'random' },
    ]) {
      expect(() => parsePayload(settingsSchema, bad)).toThrow(GameError);
    }
    expect(() => parsePayload(voteSchema, { category: 'prettiest', turnNumber: 1 })).toThrow(GameError);
    expect(() => parsePayload(reactionSchema, { emoji: '💩' })).toThrow(GameError);
    expect(() => parsePayload(teamSchema, { team: 4 })).toThrow(GameError);
  });
});
