import { Injectable, inject } from '@angular/core';
import type { LeaderboardEntry, PlayerStats, RoomDirectory } from '@dws/shared';
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

  private async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, { headers });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    return (await res.json()) as T;
  }
}
