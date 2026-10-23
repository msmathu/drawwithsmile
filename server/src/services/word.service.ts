import { WORD_CHOICE_COUNT, normalizeGuess, type Difficulty, type DifficultySetting, type Language } from '@dws/shared';
import { seedWords } from '../../seeds/words.js';
import type { WordEntry } from '../models/game-records.js';
import type { WordRepository } from '../database/repositories.js';
import type { Logger } from '../utils/logger.js';
import { pickRandom, shuffle } from '../utils/ids.js';

export interface WordQuery {
  language: Language;
  difficulty: DifficultySetting;
  categories: readonly string[];
  /** Normalised words to avoid (recently used in the room). */
  exclude: ReadonlySet<string>;
}

/** Keeps the word list in memory and picks choices for the drawer. */
export class WordService {
  private words: WordEntry[] = [];

  constructor(words: WordEntry[] = builtInWords()) {
    this.setWords(words);
  }

  /** Loads active words from the database, keeping the built-in list on failure. */
  async loadFrom(repository: WordRepository, logger: Logger): Promise<void> {
    try {
      const words = await repository.loadActiveWords();
      if (words.length > 0) {
        this.setWords(words);
        logger.info('Loaded words from database', { count: words.length });
        return;
      }
      logger.warn('Word table is empty; using the built-in word list');
    } catch (err) {
      logger.error('Could not load words from database; using the built-in word list', { err });
    }
  }

  setWords(words: WordEntry[]): void {
    const seen = new Set<string>();
    this.words = words.filter((w) => {
      const key = `${w.language}:${normalizeGuess(w.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  get count(): number {
    return this.words.length;
  }

  countsByLanguage(): Record<Language, number> {
    const counts: Record<Language, number> = { en: 0, ta: 0 };
    for (const w of this.words) counts[w.language]++;
    return counts;
  }

  /**
   * Picks distinct word choices. "mixed" offers one easy, one medium and one hard
   * word when available. Recently used words are skipped unless nothing else is left.
   */
  pickChoices(query: WordQuery, count = WORD_CHOICE_COUNT): WordEntry[] {
    const inCategory = this.words.filter(
      (w) => w.language === query.language && (query.categories.length === 0 || query.categories.includes(w.category)),
    );
    const pool = inCategory.length > 0 ? inCategory : this.words.filter((w) => w.language === query.language);
    const fresh = pool.filter((w) => !query.exclude.has(normalizeGuess(w.text)));

    const chosen: WordEntry[] = [];
    const take = (from: WordEntry[], filter: (w: WordEntry) => boolean): boolean => {
      const word = pickRandom(from.filter((w) => filter(w) && !chosen.includes(w)));
      if (word) chosen.push(word);
      return word !== undefined;
    };

    const levels: Difficulty[] =
      query.difficulty === 'mixed' ? ['easy', 'medium', 'hard'] : Array<Difficulty>(count).fill(query.difficulty);
    // Prefer fresh words of the wanted difficulty, then any fresh word, then recently used ones.
    for (const level of levels.slice(0, count)) {
      if (!take(fresh, (w) => w.difficulty === level)) take(fresh, () => true);
    }
    while (chosen.length < count && take(pool, () => true));

    const order: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
    return query.difficulty === 'mixed' ? chosen.sort((a, b) => order[a.difficulty] - order[b.difficulty]) : shuffle(chosen);
  }
}

export function builtInWords(): WordEntry[] {
  return seedWords().map((w) => ({ id: null, ...w }));
}
