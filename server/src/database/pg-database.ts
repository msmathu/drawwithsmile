import pg from 'pg';
import type { AppConfig } from '../config/env.js';
import type { Database } from './db.js';

function sslOptions(config: AppConfig['db']): pg.PoolConfig['ssl'] {
  switch (config.ssl) {
    case 'disable':
      return false;
    case 'verify':
      return config.caCert ? { ca: config.caCert, rejectUnauthorized: true } : { rejectUnauthorized: true };
    case 'require':
    default:
      // Encrypted, but without certificate verification. Set DATABASE_SSL=verify
      // with DATABASE_CA_CERT (Supabase provides one) for full verification.
      return { rejectUnauthorized: false };
  }
}

/** Strips sslmode from the URL so our explicit ssl options are used. */
function connectionString(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function createPgDatabase(config: AppConfig['db']): Database {
  const pool = new pg.Pool({
    connectionString: connectionString(config.url!),
    ssl: sslOptions(config),
    max: config.poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Without a listener, an idle client error would crash the process.
  pool.on('error', (err) => console.error('Postgres pool error', err.message));

  return {
    kind: 'postgres',
    async query<T>(sql: string, params: unknown[] = []) {
      const result = await pool.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async exec(sql: string) {
      await pool.query(sql);
    },
    async transaction<T>(fn: (tx: Pick<Database, 'query' | 'exec'>) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          async query<R>(sql: string, params: unknown[] = []) {
            const r = await client.query(sql, params);
            return { rows: r.rows as R[] };
          },
          async exec(sql: string) {
            await client.query(sql);
          },
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
