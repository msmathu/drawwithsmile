import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { usesDevSecret, type AppConfig } from './config/env.js';
import { createDatabase, type Database } from './database/db.js';
import { runMigrations } from './database/migrate.js';
import { WordRepository } from './database/repositories.js';
import { isWordTableEmpty, seedDatabase } from './database/seed.js';
import { PersistenceService } from './services/persistence.service.js';
import { SessionService } from './services/session.service.js';
import { WordService } from './services/word.service.js';
import { attachSocketServer, onlineCount, type SocketLayer } from './sockets/socket-server.js';
import type { Logger } from './utils/logger.js';

export interface GameServer {
  httpServer: HttpServer;
  sockets: SocketLayer;
  persistence: PersistenceService;
  sessions: SessionService;
  db: Database | null;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** Connects (and migrates) the database. Returns null if it is unreachable, so the game still runs. */
async function connectDatabase(config: AppConfig, logger: Logger): Promise<Database | null> {
  let db: Database | null = null;
  try {
    db = await createDatabase(config.db);
    await db.query('SELECT 1');
    if (config.db.runMigrationsOnStart) {
      await runMigrations(db, logger);
      if (await isWordTableEmpty(db)) await seedDatabase(db, logger);
    }
    logger.info('Database ready', { mode: config.db.mode });
    return db;
  } catch (err) {
    logger.error('Database unavailable — results will not be saved until it is fixed', { err, mode: config.db.mode });
    await db?.close().catch(() => undefined);
    return null;
  }
}

export async function createGameServer(
  config: AppConfig,
  logger: Logger,
  options: { db?: Database | null } = {},
): Promise<GameServer> {
  if (usesDevSecret(config) && config.env !== 'test') {
    logger.warn('Using the development SESSION_SECRET. Set SESSION_SECRET before deploying.');
  }

  const db = options.db !== undefined ? options.db : await connectDatabase(config, logger);
  const words = new WordService();
  if (db) await words.loadFrom(new WordRepository(db), logger);

  const persistence = new PersistenceService(db, logger);
  const sessions = new SessionService(config.sessionSecret);

  let sockets: SocketLayer | undefined;
  const app = createApp(config, logger, {
    sessions,
    words,
    persistence,
    rooms: () => sockets!.rooms,
    online: () => (sockets ? onlineCount(sockets) : 0),
    dbKind: db?.kind ?? null,
    startedAt: Date.now(),
  });
  const httpServer = createServer(app);
  sockets = attachSocketServer(httpServer, { config, logger, sessions, words, persistence });
  const layer = sockets;

  return {
    httpServer,
    sockets: layer,
    persistence,
    sessions,
    db,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => resolve((httpServer.address() as AddressInfo).port));
      });
    },
    async close() {
      await layer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await persistence.flush();
      if (options.db === undefined) await db?.close();
    },
  };
}
