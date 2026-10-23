import { describe, expect, it } from 'vitest';
import {
  buildHint,
  containsWord,
  editDistance,
  hintCount,
  isCloseGuess,
  isValidNickname,
  isValidRoomCode,
  normalizeGuess,
  normalizeRoomCode,
  splitGraphemes,
} from './text.js';

describe('normalizeGuess', () => {
  it('ignores case, extra whitespace and hyphens', () => {
    expect(normalizeGuess('  Ice-CREAM  ')).toBe('ice cream');
    expect(normalizeGuess('ice   cream!')).toBe('ice cream');
  });

  it('normalises Tamil text to NFC and strips zero-width characters', () => {
    const decomposed = 'யானை'.normalize('NFD');
    expect(normalizeGuess(`${decomposed}​`)).toBe('யானை');
  });
});

describe('splitGraphemes', () => {
  it('keeps Tamil consonant + vowel sign together', () => {
    expect(splitGraphemes('யானை')).toEqual(['யா', 'னை']);
    expect(splitGraphemes('cat')).toEqual(['c', 'a', 't']);
  });
});

describe('hints', () => {
  it('masks letters but shows spaces', () => {
    expect(buildHint('hot dog', new Set())).toEqual([null, null, null, ' ', null, null, null]);
    expect(buildHint('hot dog', new Set([0]))).toEqual(['h', null, null, ' ', null, null, null]);
  });

  it('reveals more letters for longer words', () => {
    expect(hintCount('cat')).toBe(0);
    expect(hintCount('horse')).toBe(1);
    expect(hintCount('elephant')).toBe(2);
    expect(hintCount('basketball')).toBe(3);
  });
});

describe('guess helpers', () => {
  it('computes grapheme edit distance', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abcdef', 'x', 1)).toBe(2);
  });

  it('detects close guesses', () => {
    expect(isCloseGuess('elephent', 'elephant')).toBe(true);
    expect(isCloseGuess('elephant', 'elephant')).toBe(false);
    expect(isCloseGuess('dog', 'cat')).toBe(false);
    expect(isCloseGuess('cot', 'cat')).toBe(false);
  });

  it('detects the word inside a message', () => {
    expect(containsWord('it is a big Banana!', 'banana')).toBe(true);
    expect(containsWord('hot  dog yum', 'hot dog')).toBe(true);
    expect(containsWord('hotdog', 'hot dog')).toBe(true);
    expect(containsWord('nothing here', 'banana')).toBe(false);
  });
});

describe('validation helpers', () => {
  it('validates nicknames', () => {
    expect(isValidNickname('Smiley_99')).toBe(true);
    expect(isValidNickname('மது')).toBe(true);
    expect(isValidNickname('a')).toBe(false);
    expect(isValidNickname('<script>')).toBe(false);
    expect(isValidNickname('x'.repeat(17))).toBe(false);
  });

  it('validates room codes', () => {
    expect(isValidRoomCode(normalizeRoomCode('abcd-efgh'))).toBe(true);
    expect(isValidRoomCode('ABCD0FGH')).toBe(false);
    expect(isValidRoomCode('ABC')).toBe(false);
  });
});

describe('room names', () => {
  it('accepts friendly names and rejects bad ones', async () => {
    const { isValidRoomName, roomNameKey, sanitizeRoomName } = await import('./text.js');
    expect(isValidRoomName(sanitizeRoomName('  The  Kitten Room! '))).toBe(true);
    expect(isValidRoomName("Ann's & Ben's")).toBe(true);
    expect(isValidRoomName('தமிழ் அறை')).toBe(true);
    expect(isValidRoomName('ab')).toBe(false);
    expect(isValidRoomName('<b>room</b>')).toBe(false);
    expect(isValidRoomName('x'.repeat(25))).toBe(false);
    expect(roomNameKey('The KITTEN  Room')).toBe(roomNameKey('the kitten room'));
  });
});
