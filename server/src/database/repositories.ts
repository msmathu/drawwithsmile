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
      accepted: string[] | null;
    }>(
      `SELECT w.id, w.text, w.difficulty, c.slug, c.language, w.accepted
         FROM words w JOIN word_categories c ON c.id = w.category_id
        WHERE w.active`,
    );
    return result.rows.map((r) => ({
      id: r.id,
      text: r.text.normalize('NFC'),
      difficulty: r.difficulty,
      category: r.slug,
      language: r.language,
      accepted: (r.accepted ?? []).map((a) => a.normalize('NFC')),
    }));
  }
}

/**
 * Achievement rules, evaluated in SQL against lifetime statistics. Because the
 * statistics are only written by the server at the end of a game, clients cannot
 * forge them.
 */
const ACHIEVEMENT_RULES = `
     (a.code = 'FIRST_GAME'      AND s.games_played >= 1)
  OR (a.code = 'FIRST_WIN'       AND s.wins >= 1)
  OR (a.code = 'HIGH_SCORER'     AND s.best_score >= 1000)
  OR (a.code = 'SHARP_EYE'       AND s.correct_guesses >= 50)
  OR (a.code = 'ARTIST'          AND s.drawings >= 25)
  OR (a.code = 'VETERAN'         AND s.games_played >= 25)
  OR (a.code = 'QUICK_GUESSER'   AND s.quick_guesses >= 10)
  OR (a.code = 'MASTER_DOODLER'  AND s.perfect_drawings >= 10)
  OR (a.code = 'TEAM_CHAMPION'   AND s.team_wins >= 1)
  OR (a.code = 'CHAOS_SURVIVOR'  AND s.chaos_turns >= 5)
  OR (a.code = 'TEAM_PLAYER'     AND s.collab_drawings >= 3)
  OR (a.code = 'CREATIVE_LEGEND' AND s.votes_received >= 10)`;

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
           (id, room_code, visibility, language, total_rounds, draw_time, player_count, completed, started_at, ended_at, rules)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
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
          JSON.stringify(summary.rules),
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
             (session_id, player_id, nickname, final_score, rank, correct_guesses, drawings, is_winner, team, team_win, votes_received)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            summary.sessionId,
            p.playerId,
            p.nickname,
            p.finalScore,
            p.rank,
            p.correctGuesses,
            p.drawings,
            p.isWinner,
            p.team,
            p.teamWin,
            p.votesReceived,
          ],
        );
        await tx.query(
          `INSERT INTO player_stats
             (player_id, games_played, wins, total_score, best_score, correct_guesses, drawings,
              quick_guesses, perfect_drawings, collab_drawings, chaos_turns, votes_received, team_wins, updated_at)
           VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           ON CONFLICT (player_id) DO UPDATE SET
             games_played     = player_stats.games_played + 1,
             wins             = player_stats.wins + EXCLUDED.wins,
             total_score      = player_stats.total_score + EXCLUDED.total_score,
             best_score       = GREATEST(player_stats.best_score, EXCLUDED.best_score),
             correct_guesses  = player_stats.correct_guesses + EXCLUDED.correct_guesses,
             drawings         = player_stats.drawings + EXCLUDED.drawings,
             quick_guesses    = player_stats.quick_guesses + EXCLUDED.quick_guesses,
             perfect_drawings = player_stats.perfect_drawings + EXCLUDED.perfect_drawings,
             collab_drawings  = player_stats.collab_drawings + EXCLUDED.collab_drawings,
             chaos_turns      = player_stats.chaos_turns + EXCLUDED.chaos_turns,
             votes_received   = player_stats.votes_received + EXCLUDED.votes_received,
             team_wins        = player_stats.team_wins + EXCLUDED.team_wins,
             updated_at       = now()`,
          [
            p.playerId,
            p.isWinner ? 1 : 0,
            p.finalScore,
            p.finalScore,
            p.correctGuesses,
            p.drawings,
            p.quickGuesses,
            p.perfectDrawings,
            p.collabDrawings,
            p.chaosTurns,
            p.votesReceived,
            p.teamWin ? 1 : 0,
          ],
        );
        await tx.query(
          `INSERT INTO player_achievements (player_id, achievement_code)
           SELECT s.player_id, a.code
             FROM player_stats s
             JOIN achievements a ON ${ACHIEVEMENT_RULES}
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
      quick_guesses: number;
      perfect_drawings: number;
      collab_drawings: number;
      chaos_turns: number;
      votes_received: number;
      team_wins: number;
    }>(
      `SELECT games_played, wins, total_score, best_score, correct_guesses, drawings,
              quick_guesses, perfect_drawings, collab_drawings, chaos_turns, votes_received, team_wins
         FROM player_stats WHERE player_id = $1`,
      [playerId],
    );
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
      quickGuesses: s?.quick_guesses ?? 0,
      perfectDrawings: s?.perfect_drawings ?? 0,
      collabDrawings: s?.collab_drawings ?? 0,
      chaosTurns: s?.chaos_turns ?? 0,
      votesReceived: s?.votes_received ?? 0,
      teamWins: s?.team_wins ?? 0,
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

export class ProfileRepository {
  constructor(private readonly db: Database) {}

  async earnedAchievements(playerId: string): Promise<string[]> {
    const result = await this.db.query<{ achievement_code: string }>(
      'SELECT achievement_code FROM player_achievements WHERE player_id = $1',
      [playerId],
    );
    return result.rows.map((r) => r.achievement_code);
  }

  async selection(playerId: string): Promise<{ avatarId: number | null; titleId: string | null }> {
    const result = await this.db.query<{ avatar_id: number | null; title_id: string | null }>(
      'SELECT avatar_id, title_id FROM players WHERE id = $1',
      [playerId],
    );
    const row = result.rows[0];
    return { avatarId: row?.avatar_id ?? null, titleId: row?.title_id ?? null };
  }

  async saveSelection(playerId: string, nickname: string, avatarId: number, titleId: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO players (id, nickname, avatar_id, title_id, last_seen_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET avatar_id = EXCLUDED.avatar_id, title_id = EXCLUDED.title_id, last_seen_at = now()`,
      [playerId, nickname, avatarId, titleId],
    );
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
