# Security checklist

| # | Control | Implementation | Status |
| --- | --- | --- | --- |
| 1 | Every client event validated | `server/src/sockets/schemas.ts` (zod, `.strict()` objects, bounded strings/arrays) | ✅ tested (`validation.spec.ts`) |
| 2 | Identity cannot be spoofed | HMAC-signed guest tokens; player id taken from the token only (`session.service.ts`) | ✅ tested |
| 3 | Room membership checked before chat, draw, guess or moderation | `RoomManager.roomOf(playerId)` resolves the room server-side; the client never sends a room code for actions | ✅ |
| 4 | Drawer permissions | `Room.assertDrawing()` on every draw/undo/redo/clear | ✅ tested (unit + integration) |
| 5 | No client-side scores or state | Scores computed in `scoring.ts` / `Room`; unknown fields rejected | ✅ tested |
| 6 | Secret word never leaked | only the drawer gets `turn:word`; guesses hidden; word-containing messages hidden; drawer's chat filtered | ✅ tested (unit + browser e2e) |
| 7 | Rate limiting | token buckets per IP (room create/join/quick-play) and per player (draw, chat, moderation, reports); `express-rate-limit` on REST | ✅ |
| 8 | Payload limits | `maxHttpBufferSize` 16 KB, `express.json` 10 KB, per-turn op/point caps | ✅ |
| 9 | Flooding | max rooms per instance (500), max connections per IP, duplicate-message rejection | ✅ |
| 10 | Collision-safe, hard-to-guess room codes | `crypto.randomInt`, 32-char alphabet, 8 chars (~1.1 × 10¹²), uniqueness checked; join attempts rate-limited | ✅ tested |
| 11 | Safe rendering of user content | Angular interpolation only (no `innerHTML`); nickname charset whitelist; control/bidi characters stripped | ✅ tested (`components.spec.ts`) |
| 12 | Moderation | profanity censoring, nickname and room-name filter, player and room-name reports (room hidden after 3), local mute, host kick/ban/mute, public vote-kick; actions logged to `moderation_actions` | ✅ |
| 12b | Private room privacy | listed private rooms are joinable by name (by design); unlisted rooms only by code/link and never appear in `/api/rooms` | ✅ tested |
| 12c | Game-mode integrity | room rules host-only and locked in game; chaos palette and one-stroke enforced on the server; only the pen holder may draw; votes checked for self-vote, duplicates and the deadline; team changes only in the lobby; avatars/titles validated against server-stored achievements | ✅ tested |
| 12d | Mute, report, ban | **Mute for me** hides all of a player's messages (earlier ones too) and reactions on that device, and is remembered. Anyone can report anyone in their room, once per player. The room host can kick or ban anyone, at any time, and a room ban also blocks a new guest account from the same connection. A player reported by **more than 10 different players** (`AUTO_BAN_REPORTS`) is banned permanently by player id and IP address. | ✅ tested (unit, socket integration, browser e2e) |
| 13 | HTTPS/WSS | provided by Cloudflare Pages / Render; `upgrade-insecure-requests` in production CSP | ⚠️ configured, verify after deploy |
| 14 | Security headers | Helmet (CSP, frame-ancestors none, nosniff…) on the server; generated `_headers` on Pages | ✅ verified locally |
| 15 | CORS | allow-list from `CLIENT_ORIGINS` for REST and Socket.IO | ✅ |
| 16 | Secrets out of the frontend | the client only knows the public API URL; DB credentials and `SESSION_SECRET` live in server env vars | ✅ |
| 17 | SQL injection | parameterised queries only | ✅ |
| 18 | Personal data | no e-mail, IP or real names stored; IPs only held in memory for rate limiting | ✅ |
| 19 | DB TLS | `DATABASE_SSL=require` (encrypted); `verify` + CA cert for full verification | ⚠️ choose `verify` for stricter setups |
| 20 | Dependency audit | `npm audit` clean on 2026-10-23 (Vite overridden to a patched version) | ✅ re-run regularly |

## Automatic bans: how they work

- **Distinct reporters:** each reporter counts once. A reporter is identified by their public IP, so one person with many guest accounts counts once. On shared/private networks (home Wi-Fi, LAN, mobile carrier NAT), where many people share an address, the reporter's player id is used instead.
- **Over the limit:** at more than `AUTO_BAN_REPORTS` distinct reporters (default 10, so the 11th report), the player id is banned. If they were on a public IP, that IP is banned too.
- **Not IP-banned:** loopback, private, link-local and carrier-grade NAT addresses. Banning those would lock out a whole home, school or mobile network, so only the player id is banned there.
- **Privacy:** IP addresses are never stored in plain text, only as an HMAC keyed with `SESSION_SECRET` (`player_bans.ip_hash`, `reports.reported_ip_hash`). If you rotate `SESSION_SECRET`, existing IP bans stop matching, but player-id bans still apply.
- **What a banned player sees:** they are removed from their room, their connection is refused, `POST /api/session` returns 403, and the app shows a "You have been banned" screen.
- **Undo a mistaken ban:** run `DELETE FROM player_bans WHERE player_id = '<uuid>';` in the Supabase SQL editor (or locally), then restart the server, which loads bans at startup. To stop the same reports from triggering it again, also delete that player's rows from `reports`.
- **Requires `TRUST_PROXY=1` on Render:** otherwise every player appears to come from the load balancer's private address, and IP bans are skipped (only player ids are banned).

## Known gaps

- The profanity list is short and English-only, and there is no image moderation for drawings. Rely on reports, mute and kicks.
- Reports have no admin UI. Review the `reports` table in Supabase.
- A determined attacker can create many guest sessions; the per-IP limits only slow this down. Add a CAPTCHA (for example Cloudflare Turnstile, which is free) if abuse appears.
- Guest tokens do not expire. Rotating `SESSION_SECRET` invalidates them all: players become new guests and their old stats stay with the old id.
