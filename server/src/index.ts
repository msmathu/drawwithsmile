import { loadConfig } from './config/env.js';
import { createGameServer } from './server.js';
import { createLogger } from './utils/logger.js';

const config = loadConfig();
const logger = createLogger(config.logLevel, config.env === 'production');

process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { reason: String(reason) }));

const server = await createGameServer(config, logger);
const port = await server.listen();
logger.info(`DrawWithSmile server listening on http://localhost:${port}`, {
  env: config.env,
  origins: config.clientOrigins,
  database: server.db?.kind ?? 'unavailable',
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  timer.unref();
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
