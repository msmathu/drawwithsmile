import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SessionInfo } from '@dws/shared';

const VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Stateless guest sessions. A token is `v1.<playerId>.<HMAC>`; the server can verify
 * it without storage, after restarts and on any instance sharing SESSION_SECRET.
 * Clients never choose their own player id.
 */
export class SessionService {
  constructor(private readonly secret: string) {}

  createSession(): SessionInfo {
    const playerId = randomUUID();
    return { playerId, token: this.sign(playerId) };
  }

  /** Returns the player id for a valid token, otherwise null. */
  verify(token: unknown): string | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const [version, playerId, signature] = token.split('.');
    if (version !== VERSION || !playerId || !signature || !UUID_PATTERN.test(playerId)) return null;
    const expected = Buffer.from(this.signature(playerId));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return playerId;
  }

  /** Re-issues the session for a valid token, or creates a new guest session. */
  resume(token: unknown): SessionInfo {
    const playerId = this.verify(token);
    return playerId ? { playerId, token: this.sign(playerId) } : this.createSession();
  }

  private sign(playerId: string): string {
    return `${VERSION}.${playerId}.${this.signature(playerId)}`;
  }

  private signature(playerId: string): string {
    return createHmac('sha256', this.secret).update(`${VERSION}.${playerId}`).digest('base64url');
  }
}
