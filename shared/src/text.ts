import { LIMITS, ROOM_CODE_PATTERN } from './constants.js';

const ZERO_WIDTH = /[​‌‍⁠﻿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
const NICKNAME_ALLOWED = /^[\p{L}\p{M}\p{N} _.\-]+$/u;
const ROOM_NAME_ALLOWED = /^[\p{L}\p{M}\p{N} _.\-'!&]+$/u;

const segmenter: Intl.Segmenter | null =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Splits text into user-perceived characters. Tamil letters such as "கா"
 * are one grapheme but two code points, so this matters for hints.
 */
export function splitGraphemes(text: string): string[] {
  if (segmenter) {
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Normalisation used for comparing guesses with the secret word. */
export function normalizeGuess(text: string): string {
  return text
    .normalize('NFC')
    .replace(ZERO_WIDTH, '')
    .toLocaleLowerCase('en-US')
    .replace(/[-_]+/g, ' ')
    .replace(/[.,!?;:'"`’]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes control/bidi characters and collapses whitespace. */
export function cleanText(text: string): string {
  return text.normalize('NFC').replace(CONTROL_CHARS, '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

export function sanitizeNickname(raw: string): string {
  return cleanText(raw).slice(0, LIMITS.NICKNAME_MAX * 2);
}

export function isValidNickname(nickname: string): boolean {
  const length = splitGraphemes(nickname).length;
  return length >= LIMITS.NICKNAME_MIN && length <= LIMITS.NICKNAME_MAX && NICKNAME_ALLOWED.test(nickname);
}

export function normalizeRoomCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** Levenshtein distance over graphemes, stopping early once `max` is exceeded. */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY): number {
  const s = splitGraphemes(a);
  const t = splitGraphemes(b);
  if (Math.abs(s.length - t.length) > max) return max + 1;
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[t.length]!;
}

/** True when a wrong guess is one typo away (two for long words). */
export function isCloseGuess(guess: string, word: string): boolean {
  const g = normalizeGuess(guess);
  const w = normalizeGuess(word);
  if (!g || g === w) return false;
  const len = splitGraphemes(w).length;
  if (len < 4) return false;
  const allowed = len >= 8 ? 2 : 1;
  return editDistance(g, w, allowed) <= allowed;
}

/** Characters that are shown in the hint from the start. */
export function isAlwaysVisible(grapheme: string): boolean {
  return /^[\s\-'’.&]$/.test(grapheme);
}

/** Builds the masked hint for a word, revealing the given grapheme indexes. */
export function buildHint(word: string, revealed: ReadonlySet<number>): (string | null)[] {
  return splitGraphemes(word).map((g, i) => (isAlwaysVisible(g) || revealed.has(i) ? g : null));
}

/** Indexes of graphemes that can be revealed as hints. */
export function hintableIndexes(word: string): number[] {
  return splitGraphemes(word)
    .map((g, i) => (isAlwaysVisible(g) ? -1 : i))
    .filter((i) => i >= 0);
}

/** How many letters will be revealed over a turn. */
export function hintCount(word: string): number {
  const letters = hintableIndexes(word).length;
  if (letters <= 3) return 0;
  return Math.min(3, Math.floor(letters / 3));
}

/** True when `text` contains the secret word (used to stop the drawer leaking it). */
export function containsWord(text: string, word: string): boolean {
  const w = normalizeGuess(word);
  if (!w) return false;
  const t = normalizeGuess(text);
  return t.includes(w) || t.replace(/\s/g, '').includes(w.replace(/\s/g, ''));
}

export function sanitizeRoomName(raw: string): string {
  return cleanText(raw).slice(0, LIMITS.ROOM_NAME_MAX * 2);
}

export function isValidRoomName(name: string): boolean {
  const length = splitGraphemes(name).length;
  return length >= LIMITS.ROOM_NAME_MIN && length <= LIMITS.ROOM_NAME_MAX && ROOM_NAME_ALLOWED.test(name);
}

/** Case-insensitive key used to keep room names unique. */
export function roomNameKey(name: string): string {
  return cleanText(name).toLocaleLowerCase('en-US');
}

/**
 * True when the guess matches the word or one of its curated accepted answers
 * (synonyms, spelling variants, transliterations). Matching uses normalizeGuess,
 * which never removes Tamil vowel signs or the pulli, so different Tamil words
 * (e.g. பால் / பல் / பலா) stay different. Spaces are ignored ("icecream" = "ice cream").
 */
export function isCorrectGuess(guess: string, answers: readonly string[]): boolean {
  const g = normalizeGuess(guess);
  if (!g) return false;
  const compact = g.replace(/ /g, '');
  return answers.some((answer) => {
    const a = normalizeGuess(answer);
    return a === g || a.replace(/ /g, '') === compact;
  });
}
