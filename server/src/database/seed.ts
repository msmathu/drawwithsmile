import { CATEGORIES } from '@dws/shared';
import { seedWords } from '../../seeds/words.js';
import type { Logger } from '../utils/logger.js';
import type { Database } from './db.js';

/** Inserts categories and words. Safe to run repeatedly (ON CONFLICT DO NOTHING). */
export async function seedDatabase(db: Database, logger: Logger): Promise<{ words: number }> {
  const words = seedWords();
  let inserted = 0;

  await db.transaction(async (tx) => {
    for (const category of CATEGORIES) {
      for (const language of ['en', 'ta'] as const) {
        await tx.query(
          `INSERT INTO word_categories (slug, language, name) VALUES ($1, $2, $3)
           ON CONFLICT (slug, language) DO UPDATE SET name = EXCLUDED.name`,
          [category.slug, language, category.label[language]],
        );
      }
    }

    const ids = await tx.query<{ id: number; slug: string; language: string }>(
      'SELECT id, slug, language FROM word_categories',
    );
    const categoryId = new Map(ids.rows.map((r) => [`${r.language}:${r.slug}`, r.id]));

    // One multi-row insert per category keeps round trips low on remote databases.
    const groups = new Map<number, typeof words>();
    for (const word of words) {
      const id = categoryId.get(`${word.language}:${word.category}`);
      if (id === undefined) throw new Error(`Unknown category ${word.language}:${word.category}`);
      groups.set(id, [...(groups.get(id) ?? []), word]);
    }
    for (const [id, group] of groups) {
      const params: unknown[] = [];
      const values = group.map((w, i) => {
        params.push(id, w.text, w.difficulty);
        return `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`;
      });
      const result = await tx.query<{ id: number }>(
        `INSERT INTO words (category_id, text, difficulty) VALUES ${values.join(', ')}
         ON CONFLICT (category_id, text) DO NOTHING RETURNING id`,
        params,
      );
      inserted += result.rows.length;
    }
  });

  logger.info('Seeded words', { inserted, total: words.length });
  return { words: inserted };
}

export async function isWordTableEmpty(db: Database): Promise<boolean> {
  const result = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM words');
  return (result.rows[0]?.n ?? 0) === 0;
}
