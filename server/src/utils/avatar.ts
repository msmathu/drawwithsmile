import { AVATAR_COUNT } from '@dws/shared';

/** Stable free avatar for a player who hasn't picked one. */
export function defaultAvatar(playerId: string): number {
  let hash = 0;
  for (const char of playerId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % AVATAR_COUNT;
}
