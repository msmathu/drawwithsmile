import type { Achievement, Difficulty, Language, LeaderboardEntry, PlayerStats, ReportReason } from '@dws/shared';
import type { GameSummary, ModerationActionType, WordEntry } from '../models/game-records.js';
import type { Database } from './db.js';

export class WordRepository {
  constructor(private readonly db: Database) {}

  async loadActiveWords(): Promise<WordEntry[]> {
    const result = await this.db.query<{
      id: number;
      text: string;
      difficulty: Difficulty;
      slug: string;
      language: Language;
    }>(
      `SELECT w.id, w.text, w.difficulty, c.slug, c.language
         FROM words w JOIN word_categories c ON c.id = w.category_id
        WHERE w.active`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      text: r.text.normalize('NFC'),
      difficulty: r.difficulty,
      category: r.slug,
      language: r.language,
    }));
  }
}

export class GameRepository {
  constructor(private readonly db: Database) {}

  /** Stores a finished game, updates player statistics and grants achievements. */
  async saveGame(summary: GameSummary): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const p of summary.players) {
        await tx.query(
          `INSERT INTO players (id, nickname, last_seen_at) VALUES ($1, $2, now())
           ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname, last_seen_at = now()`,
          [p.playerId, p.nickname],
        );
      }

      await tx.query(
        `INSERT INTO game_sessions
           (id, room_code, visibility, language, total_rounds, draw_time, player_count, completed, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          summary.sessionId,
          summary.roomCode,
          summary.visibility,
          summary.language,
          summary.totalRounds,
          summary.drawTime,
          summary.players.length,
          summary.completed,
          summary.startedAt,
          summary.endedAt,
        ],
      );

      const knownPlayers = new Set(summary.players.map((p) => p.playerId));
      for (const t of summary.turns) {
        await tx.query(
          `INSERT INTO game_rounds
             (session_id, round_number, turn_number, drawer_id, word_id, word_text, correct_guesses, end_reason, started_at, ended_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            summary.sessionId,
            t.round,
            t.turnNumber,
            knownPlayers.has(t.drawerId) ? t.drawerId : null,
            t.wordId,
            t.wordText,
            t.correctGuesses,
            t.endReason,
            t.startedAt,
            t.endedAt,
          ],
        );
      }

      for (const p of summary.players) {
        await tx.query(
          `INSERT INTO player_results
             (session_id, player_id, nickname, final_score, rank, correct_guesses, drawings, is_winner)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [summary.sessionId, p.playerId, p.nickname, p.finalScore, p.rank, p.correctGuesses, p.drawings, p.isWinner],
        );
        await tx.query(
          `INSERT INTO player_stats (player_id, games_played, wins, total_score, best_score, correct_guesses, drawings, updated_at)
           VALUES ($1, 1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (player_id) DO UPDATE SET
             games_played    = player_stats.games_played + 1,
             wins            = player_stats.wins + EXCLUDED.wins,
             total_score     = player_stats.total_score + EXCLUDED.total_score,
             best_score      = GREATEST(player_stats.best_score, EXCLUDED.best_score),
             correct_guesses = player_stats.correct_guesses + EXCLUDED.correct_guesses,
             drawings        = player_stats.drawings + EXCLUDED.drawings,
             updated_at      = now()`,
          [p.playerId, p.isWinner ? 1 : 0, p.finalScore, p.finalScore, p.correctGuesses, p.drawings],
        );
        await tx.query(
          `INSERT INTO player_achievements (player_id, achievement_code)
           SELECT s.player_id, a.code
             FROM player_stats s
             JOIN achievements a ON
                  (a.code = 'FIRST_GAME'  AND s.games_played >= 1)
               OR (a.code = 'FIRST_WIN'   AND s.wins >= 1)
               OR (a.code = 'HIGH_SCORER' AND s.best_score >= 1000)
               OR (a.code = 'SHARP_EYE'   AND s.correct_guesses >= 50)
               OR (a.code = 'ARTIST'      AND s.drawings >= 25)
               OR (a.code = 'VETERAN'     AND s.games_played >= 25)
            WHERE s.player_id = $1
           ON CONFLICT DO NOTHING`,
          [p.playerId],
        );
      }
    });
  }
}

export class StatsRepository {
  constructor(private readonly db: Database) {}

  async leaderboard(limit = 20): Promise<LeaderboardEntry[]> {
    const result = await this.db.query<{ nickname: string; total_score: string; wins: number; games_played: number }>(
      `SELECT p.nickname, s.total_score, s.wins, s.games_played
         FROM player_stats s JOIN players p ON p.id = s.player_id
        WHERE s.total_score > 0
        ORDER BY s.total_score DESC, s.wins DESC, s.games_played ASC
        LIMIT $1`,
      [limit],
    );
    return result.rows.map((r, i) => ({
      rank: i + 1,
      nickname: r.nickname,
      totalScore: Number(r.total_score),
      wins: r.wins,
      gamesPlayed: r.games_played,
    }));
  }

  async playerStats(playerId: string): Promise<PlayerStats> {
    const stats = await this.db.query<{
      games_played: number;
      wins: number;
      total_score: string;
      best_score: number;
      correct_guesses: number;
      drawings: number;
    }>('SELECT games_played, wins, total_score, best_score, correct_guesses, drawings FROM player_stats WHERE player_id = $1', [
      playerId,
    ]);
    const achievements = await this.db.query<{ code: string; name: string; description: string; earned_at: Date | null }>(
      `SELECT a.code, a.name, a.description, pa.earned_at
         FROM achievements a
         LEFT JOIN player_achievements pa ON pa.achievement_code = a.code AND pa.player_id = $1
        ORDER BY a.sort_order`,
      [playerId],
    );
    const s = stats.rows[0];
    return {
      playerId,
      gamesPlayed: s?.games_played ?? 0,
      wins: s?.wins ?? 0,
      totalScore: Number(s?.total_score ?? 0),
      bestScore: s?.best_score ?? 0,
      correctGuesses: s?.correct_guesses ?? 0,
      drawings: s?.drawings ?? 0,
      achievements: achievements.rows.map(
        (a): Achievement => ({
          code: a.code,
          name: a.name,
          description: a.description,
          earnedAt: a.earned_at ? new Date(a.earned_at).toISOString() : null,
        }),
      ),
    };
  }
}

export class ModerationRepository {
  constructor(private readonly db: Database) {}

  async saveReport(report: {
    reporterId: string;
    reportedId: string;
    reportedNickname: string;
    roomCode: string;
    reason: ReportReason;
    details?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO reports (reporter_id, reported_id, reported_nickname, room_code, reason, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [report.reporterId, report.reportedId, report.reportedNickname, report.roomCode, report.reason, report.details ?? null],
    );
  }

  async saveAction(action: {
    roomCode: string;
    actorId: string | null;
    targetId: string;
    action: ModerationActionType;
    reason?: string;
  }): Promise<void> {
    await this.db.query(
      `INSERT INTO moderation_actions (room_code, actor_id, target_id, action, reason) VALUES ($1, $2, $3, $4, $5)`,
      [action.roomCode, action.actorId, action.targetId, action.action, action.reason ?? null],
    );
  }
}
