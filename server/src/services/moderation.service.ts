import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { ReportReason } from '@dws/shared';
import type { Database } from '../database/db.js';
import type { Logger } from '../utils/logger.js';

/**
 * True for addresses that identify one internet connection. Loopback, private LAN,
 * link-local and carrier-grade NAT ranges are shared by many people (a whole home,
 * school or mobile network), so they are never IP-banned.
 */
export function isPublicIp(raw: string): boolean {
  const ip = raw.replace(/^::ffff:/i, '');
  const version = isIP(ip);
  if (version === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT (mobile networks)
    return true;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return false;
    if (/^f[cd]/.test(lower)) return false; // unique local
    if (/^fe[89ab]/.test(lower)) return false; // link-local
    return true;
  }
  return false;
}

export interface PlayerReport {
  reporterId: string;
  reporterIp: string;
  reportedId: string;
  /** Last known address of the reported player (null if unknown). */
  reportedIp: string | null;
  reportedNickname: string;
  roomCode: string;
  reason: ReportReason;
  details?: string;
}

export interface ReportOutcome {
  /** This reporter (or their connection) had already reported this player. */
  duplicate: boolean;
  /** Distinct reporters so far. */
  reporters: number;
  /** The report pushed the player over the limit and they are now banned. */
  banned: boolean;
}

/**
 * Player reports and permanent bans.
 *
 * - Reports are counted once per *reporter*, where a reporter is their public IP
 *   (so one person with many guest accounts counts once) or, on shared/private
 *   networks, their player id.
 * - When a player has been reported by MORE than `threshold` distinct reporters,
 *   their player id and IP address are banned permanently.
 * - IP addresses are stored only as a keyed hash (HMAC), never in plain text.
 */
export class ModerationService {
  private readonly bannedPlayers = new Set<string>();
  private readonly bannedIps = new Set<string>();
  /** Used when there is no database: reported id -> reporter keys. */
  private readonly memoryReports = new Map<string, Set<string>>();

  constructor(
    private readonly db: Database | null,
    private readonly secret: string,
    readonly threshold: number,
    private readonly logger: Logger,
  ) {}

  /** Loads existing bans (call once at startup). */
  async init(): Promise<void> {
    if (!this.db) return;
    try {
      const result = await this.db.query<{ player_id: string; ip_hash: string | null }>('SELECT player_id, ip_hash FROM player_bans');
      for (const row of result.rows) {
        this.bannedPlayers.add(row.player_id);
        if (row.ip_hash) this.bannedIps.add(row.ip_hash);
      }
      if (result.rows.length) this.logger.info('Loaded permanent bans', { count: result.rows.length });
    } catch (err) {
      this.logger.error('Could not load bans', { err });
    }
  }

  /** Keyed hash of a public IP, or null for shared/private addresses. */
  ipKey(ip: string | null | undefined): string | null {
    if (!ip || !isPublicIp(ip)) return null;
    return createHmac('sha256', this.secret).update(`ip:${ip.replace(/^::ffff:/i, '')}`).digest('hex');
  }

  isBanned(playerId: string | null, ip: string | null): boolean {
    if (playerId && this.bannedPlayers.has(playerId)) return true;
    const key = this.ipKey(ip);
    return key !== null && this.bannedIps.has(key);
  }

  async report(input: PlayerReport): Promise<ReportOutcome> {
    const reporterKey = this.ipKey(input.reporterIp) ?? `player:${input.reporterId}`;
    const reportedIpHash = this.ipKey(input.reportedIp);
    let reporters: number;

    if (this.db) {
      const existing = await this.db.query(
        'SELECT 1 FROM reports WHERE reported_id = $1 AND (reporter_id = $2 OR reporter_key = $3) LIMIT 1',
        [input.reportedId, input.reporterId, reporterKey],
      );
      if (existing.rows.length > 0) return { duplicate: true, reporters: await this.countReporters(input.reportedId), banned: false };
      await this.db.query(
        `INSERT INTO reports (reporter_id, reported_id, reported_nickname, room_code, reason, details, reporter_key, reported_ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.reporterId,
          input.reportedId,
          input.reportedNickname,
          input.roomCode,
          input.reason,
          input.details ?? null,
          reporterKey,
          reportedIpHash,
        ],
      );
      reporters = await this.countReporters(input.reportedId);
    } else {
      const keys = this.memoryReports.get(input.reportedId) ?? new Set<string>();
      if (keys.has(reporterKey)) return { duplicate: true, reporters: keys.size, banned: false };
      keys.add(reporterKey);
      this.memoryReports.set(input.reportedId, keys);
      reporters = keys.size;
    }

    if (reporters > this.threshold && !this.bannedPlayers.has(input.reportedId)) {
      await this.ban(input.reportedId, input.reportedIp, `Reported by ${reporters} different players`, reporters);
      return { duplicate: false, reporters, banned: true };
    }
    return { duplicate: false, reporters, banned: false };
  }

  /** Permanently bans a player id and (if public) their IP address. */
  async ban(playerId: string, ip: string | null, reason: string, reportCount = 0): Promise<void> {
    const ipHash = this.ipKey(ip);
    this.bannedPlayers.add(playerId);
    if (ipHash) this.bannedIps.add(ipHash);
    this.logger.warn('Player permanently banned', { playerId, ipBanned: ipHash !== null, reason });
    if (!this.db) return;
    try {
      await this.db.query('INSERT INTO player_bans (player_id, ip_hash, reason, report_count) VALUES ($1, $2, $3, $4)', [
        playerId,
        ipHash,
        reason.slice(0, 200),
        reportCount,
      ]);
    } catch (err) {
      this.logger.error('Could not save ban (it still applies until restart)', { err, playerId });
    }
  }

  private async countReporters(reportedId: string): Promise<number> {
    const result = await this.db!.query<{ n: number }>(
      'SELECT count(DISTINCT reporter_key)::int AS n FROM reports WHERE reported_id = $1 AND reporter_key IS NOT NULL',
      [reportedId],
    );
    return result.rows[0]?.n ?? 0;
  }
}
