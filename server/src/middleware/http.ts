import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { SessionService } from '../services/session.service.js';
import type { Logger } from '../utils/logger.js';

export interface AuthedRequest extends Request {
  playerId?: string;
}

/** Requires `Authorization: Bearer <session token>` and exposes the verified player id. */
export function requireSession(sessions: SessionService): RequestHandler {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const playerId = sessions.verify(token);
    if (!playerId) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Missing or invalid session.' } });
      return;
    }
    req.playerId = playerId;
    next();
  };
}

export const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate-limited', message: 'Too many requests. Please slow down.' } },
});

export const sessionRateLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'rate-limited', message: 'Too many requests. Please slow down.' } },
});

/** Wraps async handlers so rejected promises reach the error handler. */
export function asyncHandler(fn: (req: AuthedRequest, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not-found', message: 'Not found.' } });
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, _next) => {
    const status = typeof (err as { status?: unknown }).status === 'number' ? (err as { status: number }).status : 500;
    if (status >= 500) logger.error('HTTP request failed', { err, path: req.path });
    res.status(status).json({
      error: {
        code: status === 400 ? 'bad-request' : status >= 500 ? 'server-error' : 'error',
        message: status >= 500 ? 'Something went wrong.' : 'Invalid request.',
      },
    });
  };
}
