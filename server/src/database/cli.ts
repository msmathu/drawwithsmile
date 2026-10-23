/**
 * Database command line:
 *   npm run db:migrate   apply pending migrations
 *   npm run db:seed      migrate, then insert the starter word list
 */
import { loadConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

const command = process.argv[2];
const config = loadConfig();
const logger = createLogger(config.logLevel, false);

if (command !== 'migrate' && command !== 'seed') {
  logger.error('Usage: cli.ts <migrate|seed>');
  process.exit(1);
}

const db = await createDatabase(config.db);
try {
  logger.info('Connected', { mode: config.db.mode });
  const applied = await runMigrations(db, logger);
  logger.info(applied.length ? `Applied ${applied.length} migration(s)` : 'Schema is up to date');
  if (command === 'seed') await seedDatabase(db, logger);
} catch (err) {
  logger.error('Database command failed', { err });
  process.exitCode = 1;
} finally {
  await db.close();
}
