import { Injectable, inject } from '@angular/core';
import type { LeaderboardEntry, PlayerProfile, PlayerStats, RoomDirectory } from '@dws/shared';
import { API_URL } from '../config';
import { SessionService } from './session.service';

/** REST calls for non-realtime data. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly session = inject(SessionService);

  /** Room browser: public rooms, listed private rooms, totals and players online. */
  async rooms(): Promise<RoomDirectory> {
    return this.get('/api/rooms');
  }

  async leaderboard(): Promise<{ entries: LeaderboardEntry[]; persistent: boolean }> {
    return this.get('/api/leaderboard');
  }

  async myStats(): Promise<{ stats: PlayerStats | null; persistent: boolean }> {
    await this.session.ensure();
    return this.get('/api/me/stats', { authorization: `Bearer ${this.session.getToken()}` });
  }

  async profile(): Promise<PlayerProfile> {
    await this.session.ensure();
    return this.get('/api/me/profile', this.auth());
  }

  /** Saves a new avatar/title. The server rejects anything that isn't unlocked. */
  async saveProfile(change: { avatarId?: number; titleId?: string | null; nickname?: string }): Promise<PlayerProfile> {
    await this.session.ensure();
    const res = await fetch(`${API_URL}/api/me/profile`, {
      method: 'POST',
      headers: { ...this.auth(), 'content-type': 'application/json' },
      body: JSON.stringify(change),
    });
    const body = (await res.json()) as PlayerProfile & { error?: { message: string } };
    if (!res.ok) throw new Error(body.error?.message ?? 'Could not save your profile.');
    return body;
  }

  private auth(): Record<string, string> {
    return { authorization: `Bearer ${this.session.getToken()}` };
  }

  private async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, { headers });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as T;
  }
}
