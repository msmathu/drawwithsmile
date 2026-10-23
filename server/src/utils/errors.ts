import type { ErrorCode, ErrorPayload } from '@dws/shared';

/** An expected, user-facing error (bad input, wrong phase, permissions…). */
export class GameError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GameError';
  }

  toPayload(): ErrorPayload {
    return { code: this.code, message: this.message };
  }
}

export function toErrorPayload(err: unknown): ErrorPayload {
  if (err instanceof GameError) return err.toPayload();
  return { code: 'server-error', message: 'Something went wrong. Please try again.' };
}
