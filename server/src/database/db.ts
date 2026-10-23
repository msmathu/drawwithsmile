import type { AppConfig } from '../config/env.js';

export interface QueryResult<T> {
  rows: T[];
}

/**
 * The small database surface the app needs. Implemented by node-postgres
 * (Supabase / any Postgres) and by PGlite (embedded Postgres for local dev and tests),
 * so the same SQL runs everywhere.
 */
export interface Database {
  readonly kind: 'postgres' | 'pglite';
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Runs several statements (no parameters), used by migrations. */
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (tx: Pick<Database, 'query' | 'exec'>) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function createDatabase(config: AppConfig['db']): Promise<Database> {
  if (config.mode === 'postgres') {
    const { createPgDatabase } = await import('./pg-database.js');
    return createPgDatabase(config);
  }
  const { createPgliteDatabase } = await import('./pglite-database.js');
  return createPgliteDatabase(config.mode === 'memory' ? undefined : config.pgliteDir);
}
