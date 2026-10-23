/** Injected at build time by scripts/build.mjs (`--define`). Absent in `ng serve`. */
declare const DWS_API_URL: string | undefined;

/**
 * Base URL of the game server. Empty means "same origin" (dev proxy, or the
 * server serving the client). Production builds set it to the backend URL.
 */
export const API_URL: string = typeof DWS_API_URL !== 'undefined' ? DWS_API_URL : '';

export const ACK_TIMEOUT_MS = 8_000;
