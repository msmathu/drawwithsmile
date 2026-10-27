import { Injectable, inject, signal } from '@angular/core';
import type { SessionInfo } from '@dws/shared';
import { API_URL } from '../config';
import { StorageService } from './storage.service';

/**
 * Guest identity. The server issues a signed token; the player id inside it is
 * what the server trusts. Stored locally so refreshes keep the same identity.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly storage = inject(StorageService);
  readonly playerId = signal<string | null>(this.storage.get('dws.playerId'));
  private token: string | null = this.storage.get('dws.token');
  private pending: Promise<SessionInfo> | null = null;

  getToken(): string | null {
    return this.token;
  }

  /** Validates (or creates) the session with the server. Concurrent calls share one request. */
  ensure(): Promise<SessionInfo> {
    this.pending ??= this.request().finally(() => (this.pending = null));
    return this.pending;
  }

  private async request(): Promise<SessionInfo> {
    const res = await fetch(`${API_URL}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: this.token }),
    });
    if (res.status === 403) throw new Error('banned');
    if (!res.ok) throw new Error(`Session request failed (${res.status})`);
    const session = (await res.json()) as SessionInfo;
    this.token = session.token;
    this.playerId.set(session.playerId);
    this.storage.set('dws.token', session.token);
    this.storage.set('dws.playerId', session.playerId);
    return session;
  }
}
