// Production build wrapper: injects the public backend URL at build time and
// writes Cloudflare Pages security headers that allow connecting to it.
//   DWS_API_URL=https://drawwithsmile-api.onrender.com npm run build
// Leave DWS_API_URL empty when the server also serves the client (same origin).
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ngCli = require.resolve('@angular/cli/bin/ng.js');
const OUT = new URL('../dist/drawwithsmile-web/browser/', import.meta.url);

const apiUrl = (process.env.DWS_API_URL ?? '').trim().replace(/\/+$/, '');
if (apiUrl && !/^https?:\/\/[^\s'"/]+(:\d+)?$/.test(apiUrl)) {
  console.error(`DWS_API_URL must be an origin like https://example.onrender.com (got: ${apiUrl})`);
  process.exit(1);
}
console.log(`Building DrawWithSmile web client (API: ${apiUrl || 'same origin'})`);

// Spawned without a shell so the quoted define value survives on every OS.
const args = [ngCli, 'build', '--define', `DWS_API_URL=${JSON.stringify(apiUrl)}`, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

if (existsSync(OUT)) {
  const wsUrl = apiUrl.replace(/^http/, 'ws');
  const connect = ["'self'", apiUrl, wsUrl, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  writeFileSync(
    new URL('_headers', OUT),
    `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY

/index.html
  Cache-Control: no-cache
/ngsw.json
  Cache-Control: no-cache
/ngsw-worker.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/*.js
  Cache-Control: public, max-age=31536000, immutable
/*.css
  Cache-Control: public, max-age=31536000, immutable
`,
  );
  console.log('Wrote Cloudflare Pages _headers');
}
