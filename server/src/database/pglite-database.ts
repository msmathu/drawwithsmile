import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Database } from './db.js';

/**
 * Embedded PostgreSQL (WASM). Used for local development without installing
 * Postgres, and in-memory for tests. Not intended for production hosting.
 */
export async function createPgliteDatabase(dataDir?: string): Promise<Database> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir);

  return {
    kind: 'pglite',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await db.query<T>(sql, params);
      return { rows: result.rows };
    },
    async exec(sql: string) {
      await db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const r = await tx.query<R>(sql, params);
            return { rows: r.rows };
          },
          async exec(sql: string) {
            await tx.exec(sql);
          },
        }),
      );
    },
    async close() {
      await db.close();
    },
  };
}
