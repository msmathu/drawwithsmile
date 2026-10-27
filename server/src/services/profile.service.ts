import { unlockedAvatarIds, unlockedTitleIds, type PlayerProfile } from '@dws/shared';
import type { Database } from '../database/db.js';
import { ProfileRepository } from '../database/repositories.js';
import type { PlayerLook } from '../models/room.js';
import { defaultAvatar } from '../utils/avatar.js';
import { GameError } from '../utils/errors.js';
import type { Logger } from '../utils/logger.js';

type LookListener = (playerId: string, look: PlayerLook) => void;

/**
 * Avatars and titles. Unlocks are always computed from achievements stored by the
 * server, so a client can only select rewards it has really earned. Works for
 * guests: progress belongs to the signed guest id.
 */
export class ProfileService {
  private readonly repo: ProfileRepository | null;
  private readonly looks = new Map<string, PlayerLook>();
  private readonly listeners: LookListener[] = [];

  constructor(
    db: Database | null,
    private readonly logger: Logger,
  ) {
    this.repo = db ? new ProfileRepository(db) : null;
  }

  /** Current look from memory (default free avatar until loaded). */
  look(playerId: string): PlayerLook {
    return this.looks.get(playerId) ?? { avatar: defaultAvatar(playerId), title: null };
  }

  onChange(listener: LookListener): void {
    this.listeners.push(listener);
  }

  /** Loads a player's saved look (called when they connect). Never throws. */
  async load(playerId: string): Promise<PlayerLook> {
    try {
      const profile = await this.profile(playerId);
      const look = { avatar: profile.avatarId, title: profile.titleId };
      this.remember(playerId, look);
      return look;
    } catch (err) {
      this.logger.warn('Could not load player profile', { err, playerId });
      return this.look(playerId);
    }
  }

  async profile(playerId: string): Promise<PlayerProfile> {
    if (!this.repo) {
      return { avatarId: this.look(playerId).avatar, titleId: null, unlockedAvatars: unlockedAvatarIds(new Set()), unlockedTitles: [], persistent: false };
    }
    const [earned, selection] = await Promise.all([this.repo.earnedAchievements(playerId), this.repo.selection(playerId)]);
    const set = new Set(earned);
    const unlockedAvatars = unlockedAvatarIds(set);
    const unlockedTitles = unlockedTitleIds(set);
    // A saved choice that is no longer unlocked (e.g. data reset) falls back safely.
    const avatarId = selection.avatarId !== null && unlockedAvatars.includes(selection.avatarId) ? selection.avatarId : defaultAvatar(playerId);
    const titleId = selection.titleId !== null && unlockedTitles.includes(selection.titleId) ? selection.titleId : null;
    return { avatarId, titleId, unlockedAvatars, unlockedTitles, persistent: true };
  }

  /** Saves a new avatar and/or title after checking the player has unlocked them. */
  async update(
    playerId: string,
    nickname: string,
    change: { avatarId?: number; titleId?: string | null },
  ): Promise<PlayerProfile> {
    if (!this.repo) throw new GameError('server-error', 'Profiles cannot be saved right now because the database is unavailable.');
    const current = await this.profile(playerId);
    const avatarId = change.avatarId ?? current.avatarId;
    const titleId = change.titleId === undefined ? current.titleId : change.titleId;
    if (!current.unlockedAvatars.includes(avatarId)) throw new GameError('bad-request', 'That avatar is still locked.');
    if (titleId !== null && !current.unlockedTitles.includes(titleId)) throw new GameError('bad-request', 'That title is still locked.');
    await this.repo.saveSelection(playerId, nickname, avatarId, titleId);
    this.remember(playerId, { avatar: avatarId, title: titleId });
    return { ...current, avatarId, titleId };
  }

  private remember(playerId: string, look: PlayerLook): void {
    this.looks.set(playerId, look);
    for (const listener of this.listeners) listener(playerId, look);
  }
}
