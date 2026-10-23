import type { Response } from 'express';
import { CATEGORIES, LANGUAGES } from '@dws/shared';
import type { AuthedRequest } from '../middleware/http.js';
import type { PersistenceService } from '../services/persistence.service.js';
import type { RoomManager } from '../services/room-manager.js';
import type { SessionService } from '../services/session.service.js';
import type { WordService } from '../services/word.service.js';

export interface ApiDeps {
  sessions: SessionService;
  rooms: () => RoomManager;
  online: () => number;
  words: WordService;
  persistence: PersistenceService;
  dbKind: string | null;
  startedAt: number;
}

export class ApiController {
  constructor(private readonly deps: ApiDeps) {}

  health = (_req: AuthedRequest, res: Response): void => {
    const stats = this.deps.rooms().stats();
    res.json({
      status: 'ok',
      uptimeSeconds: Math.round((Date.now() - this.deps.startedAt) / 1000),
      rooms: stats.rooms,
      playersInRooms: stats.players,
      online: this.deps.online(),
      database: this.deps.dbKind ?? 'unavailable',
      words: this.deps.words.count,
    });
  };

  /** Creates a guest session, or renews the one in the request body. */
  session = (req: AuthedRequest, res: Response): void => {
    const token = (req.body as { token?: unknown } | undefined)?.token;
    res.json(this.deps.sessions.resume(token));
  };

  meta = (_req: AuthedRequest, res: Response): void => {
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ languages: LANGUAGES, categories: CATEGORIES, wordCounts: this.deps.words.countsByLanguage() });
  };

  /** Room browser: public rooms, listed private rooms and totals. */
  rooms = (_req: AuthedRequest, res: Response): void => {
    res.set('Cache-Control', 'no-store');
    res.json(this.deps.rooms().directory(this.deps.online()));
  };

  leaderboard = async (_req: AuthedRequest, res: Response): Promise<void> => {
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ entries: await this.deps.persistence.leaderboard(20), persistent: this.deps.persistence.enabled });
  };

  myStats = async (req: AuthedRequest, res: Response): Promise<void> => {
    const stats = await this.deps.persistence.playerStats(req.playerId!);
    res.set('Cache-Control', 'no-store');
    res.json({ stats, persistent: this.deps.persistence.enabled });
  };
}
