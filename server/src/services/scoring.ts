import type { Difficulty } from '@dws/shared';

/**
 * All scoring rules live here, on the server. Clients only ever display scores.
 */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = { easy: 1, medium: 1.2, hard: 1.5 };
const ORDER_BONUS = [30, 20, 10];
const GUESSER_BASE = 50;
const GUESSER_TIME_BONUS = 100;
const DRAWER_PER_GUESS = 25;
const DRAWER_ALL_GUESSED_BONUS = 50;

/**
 * Points for a correct guess: 50 base + up to 100 for speed + a bonus for the
 * first three guessers, scaled by word difficulty.
 */
export function guesserPoints(params: {
  remainingMs: number;
  totalMs: number;
  /** 0 for the first correct guesser in the turn. */
  order: number;
  difficulty: Difficulty;
}): number {
  const ratio = params.totalMs > 0 ? Math.min(1, Math.max(0, params.remainingMs / params.totalMs)) : 0;
  const base = GUESSER_BASE + Math.round(GUESSER_TIME_BONUS * ratio);
  const bonus = ORDER_BONUS[params.order] ?? 0;
  return Math.round((base + bonus) * DIFFICULTY_MULTIPLIER[params.difficulty]);
}

/** Points the drawer earns each time someone guesses their drawing. */
export function drawerPointsPerGuess(difficulty: Difficulty): number {
  return Math.round(DRAWER_PER_GUESS * DIFFICULTY_MULTIPLIER[difficulty]);
}

/** Extra drawer points when every guesser got it. */
export function drawerAllGuessedBonus(difficulty: Difficulty): number {
  return Math.round(DRAWER_ALL_GUESSED_BONUS * DIFFICULTY_MULTIPLIER[difficulty]);
}

/** Standard competition ranking ("1224"): ties share a rank. */
export function rankByScore<T extends { score: number }>(items: readonly T[]): (T & { rank: number })[] {
  const sorted = [...items].sort((a, b) => b.score - a.score);
  let lastScore = Number.NaN;
  let lastRank = 0;
  return sorted.map((item, index) => {
    if (item.score !== lastScore) {
      lastRank = index + 1;
      lastScore = item.score;
    }
    return { ...item, rank: lastRank };
  });
}
