import {
  WORD_CHOICE_COUNT,
  WORD_LANGUAGES,
  normalizeGuess,
  type Difficulty,
  type DifficultySetting,
  type Language,
  type WordLanguage,
} from '@dws/shared';
import { seedWords } from '../../seeds/words.js';
import type { WordEntry } from '../models/game-records.js';
import type { WordRepository } from '../database/repositories.js';
import type { Logger } from '../utils/logger.js';
import { pickRandom, shuffle } from '../utils/ids.js';

export interface WordQuery {
  /** A single language, or "mixed" for a Language Battle across all packs. */
  language: WordLanguage;
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

  countsByLanguage(): Record<string, number> {
    const counts: Record<string, number> = Object.fromEntries(WORD_LANGUAGES.map((l) => [l, 0]));
    for (const w of this.words) counts[w.language] = (counts[w.language] ?? 0) + 1;
    return counts;
  }

  /**
   * Picks distinct word choices. Difficulty "mixed" offers one easy, one medium and one
   * hard word when available. Language "mixed" spreads the choices across languages.
   * Recently used words are skipped unless nothing else is left.
   */
  pickChoices(query: WordQuery, count = WORD_CHOICE_COUNT): WordEntry[] {
    const languages: readonly Language[] = query.language === 'mixed' ? WORD_LANGUAGES : [query.language];
    const inLanguage = this.words.filter((w) => languages.includes(w.language));
    const inCategory = inLanguage.filter((w) => query.categories.length === 0 || query.categories.includes(w.category));
    const pool = inCategory.length > 0 ? inCategory : inLanguage;
    const fresh = pool.filter((w) => !query.exclude.has(normalizeGuess(w.text)));

    const chosen: WordEntry[] = [];
    const take = (from: WordEntry[], filter: (w: WordEntry) => boolean): boolean => {
      const word = pickRandom(from.filter((w) => filter(w) && !chosen.includes(w)));
      if (word) chosen.push(word);
      return word !== undefined;
    };

    const levels: Difficulty[] =
      query.difficulty === 'mixed' ? ['easy', 'medium', 'hard'] : Array<Difficulty>(count).fill(query.difficulty);
    // In mixed-language rooms each slot prefers a different language, starting at random.
    const languageOrder = shuffle([...languages]);
    levels.slice(0, count).forEach((level, i) => {
      const lang = languageOrder[i % languageOrder.length]!;
      // Prefer fresh words of the wanted difficulty and language, then relax step by step.
      if (take(fresh, (w) => w.difficulty === level && w.language === lang)) return;
      if (take(fresh, (w) => w.language === lang)) return;
      if (take(fresh, (w) => w.difficulty === level)) return;
      take(fresh, () => true);
    });
    while (chosen.length < count && take(pool, () => true));

    const order: Record<Difficulty, number> = { easy: 0, medium: 1, hard: 2 };
    return query.difficulty === 'mixed' ? chosen.sort((a, b) => order[a.difficulty] - order[b.difficulty]) : shuffle(chosen);
  }
}

export function builtInWords(): WordEntry[] {
  return seedWords().map((w) => ({ id: null, ...w }));
}
