import type { LeaderboardEntry, PlayerStats, ReportReason } from '@dws/shared';
import type { Database } from '../database/db.js';
import { GameRepository, ModerationRepository, StatsRepository } from '../database/repositories.js';
import type { GameSummary, ModerationActionType } from '../models/game-records.js';
import type { Logger } from '../utils/logger.js';

/**
 * Writes results in the background. A database outage never breaks a running game:
 * failures are logged and the game carries on.
 */
export class PersistenceService {
  private readonly games: GameRepository | null;
  private readonly moderation: ModerationRepository | null;
  private readonly stats: StatsRepository | null;
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    db: Database | null,
    private readonly logger: Logger,
  ) {
    this.games = db ? new GameRepository(db) : null;
    this.moderation = db ? new ModerationRepository(db) : null;
    this.stats = db ? new StatsRepository(db) : null;
  }

  get enabled(): boolean {
    return this.games !== null;
  }

  recordGame(summary: GameSummary): void {
    if (!this.games) return;
    this.track(this.games.saveGame(summary), 'save game', { sessionId: summary.sessionId });
  }

  recordModeration(action: { roomCode: string; actorId: string | null; targetId: string; action: ModerationActionType }): void {
    if (!this.moderation) return;
    this.track(this.moderation.saveAction(action), 'save moderation action', { action: action.action });
  }

  recordReport(report: {
    reporterId: string;
    reportedId: string;
    reportedNickname: string;
    roomCode: string;
    reason: ReportReason;
    details?: string;
  }): void {
    if (!this.moderation) return;
    this.track(this.moderation.saveReport(report), 'save report', { reason: report.reason });
  }

  async leaderboard(limit?: number): Promise<LeaderboardEntry[]> {
    return this.stats ? this.stats.leaderboard(limit) : [];
  }

  async playerStats(playerId: string): Promise<PlayerStats | null> {
    return this.stats ? this.stats.playerStats(playerId) : null;
  }

  /** Waits for in-flight writes (used on shutdown and in tests). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private track(promise: Promise<unknown>, what: string, meta: Record<string, unknown>): void {
    const p = promise
      .catch((err: unknown) => this.logger.error(`Failed to ${what}`, { ...meta, err }))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }
}
