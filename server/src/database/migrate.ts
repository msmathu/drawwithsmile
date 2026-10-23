import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from '../utils/logger.js';
import type { Database } from './db.js';
import { migrationsDir } from './paths.js';

const LOCK_ID = 7_242_024;

/**
 * Applies `migrations/NNN_name.sql` files in order, once each. Every migration runs
 * in its own transaction under an advisory lock, so concurrent starts are safe.
 */
export async function runMigrations(db: Database, logger: Logger, dir = migrationsDir()): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(100) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();

  const applied: string[] = [];
  for (const file of files) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const didApply = await db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
      const existing = await tx.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (existing.rows.length > 0) return false;
      await tx.exec(sql);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      return true;
    });
    if (didApply) {
      applied.push(file);
      logger.info('Applied migration', { file });
    }
  }
  return applied;
}
