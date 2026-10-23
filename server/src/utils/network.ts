/**
 * Client IP for rate limiting. Only trusts X-Forwarded-For entries added by the
 * configured number of proxies (e.g. Render's load balancer), so clients cannot spoof it.
 */
export function clientIp(forwardedFor: string | string[] | undefined, remoteAddress: string, trustProxy: number): string {
  if (trustProxy > 0 && forwardedFor) {
    const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const chain = header
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const candidate = chain[chain.length - trustProxy];
    if (candidate) return candidate;
  }
  return remoteAddress || 'unknown';
}

/** Requests without an Origin header (curl, native apps) are allowed; browsers must match. */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (!origin) return true;
  return allowed.includes('*') || allowed.includes(origin.replace(/\/+$/, ''));
}
