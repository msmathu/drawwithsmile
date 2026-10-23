import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { AppConfig } from './config/env.js';
import type { ApiDeps } from './controllers/api.controller.js';
import { apiRateLimit, errorHandler, notFound } from './middleware/http.js';
import { apiRoutes } from './routes/api.routes.js';
import type { Logger } from './utils/logger.js';
import { isAllowedOrigin } from './utils/network.js';

export function createApp(config: AppConfig, logger: Logger, deps: ApiDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          // Fonts are listed because the PWA service worker fetches and caches them.
          connectSrc: ["'self'", 'ws:', 'wss:', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.env === 'production' ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin, config.clientOrigins)),
      methods: ['GET', 'POST'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10kb' }));

  app.use('/api', apiRateLimit, apiRoutes(deps));
  app.use('/api', notFound);

  // Optional single-origin mode: serve the built Angular app from this server.
  if (config.serveClientDir) {
    const dir = resolve(config.serveClientDir);
    if (existsSync(join(dir, 'index.html'))) {
      app.use(
        express.static(dir, {
          index: false,
          setHeaders: (res, path) => {
            const neverCache = /(index\.html|ngsw\.json|ngsw-worker\.js|manifest\.webmanifest)$/.test(path);
            res.setHeader('Cache-Control', neverCache ? 'no-cache' : 'public, max-age=31536000, immutable');
          },
        }),
      );
      app.get(/^(?!\/(api|socket\.io)\/).*/, (_req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(join(dir, 'index.html'));
      });
      logger.info('Serving web client', { dir });
    } else {
      logger.warn('SERVE_CLIENT_DIR has no index.html; not serving the client', { dir });
    }
  }

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
