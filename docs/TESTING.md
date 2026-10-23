# Testing guide

## Automated

```bash
npm test
```

Runs the shared, server and client suites. The server integration tests start a real HTTP + Socket.IO server on a random port with an in-memory PostgreSQL (PGlite), and connect real `socket.io-client` sockets.

## What was verified during development (2026-10-23)

| Check | Result |
| --- | --- |
| `npm test`: shared 11, server 60, client 9 tests | ✅ all passing |
| Server builds (`tsc`), client production build | ✅ |
| Migrations + seed (450 words) on embedded Postgres | ✅ |
| Headless Chrome, desktop + phone-sized (touch) context: create private room → join by invite link → start → word secrecy → live stroke sync → refresh mid-turn restores drawing → wrong + correct guess → scoring → next drawer | ✅ (dev server and production single-origin build) |
| Quick Play in Tamil: two players matched, auto-start countdown, Tamil word guessed (typed in decomposed Unicode) | ✅ |
| Service worker registration and web manifest in the production build | ✅ |
| Room browser: Create Room dialog (public, random name, 16 players) → listed as "Waiting for players 1/16" → join by click; private named room → "View all private rooms" search + report → join by typing name; late join into "Playing round 1 of 3" | ✅ |

**Not yet verified:** real Android and iOS devices, physical stylus input, clients on different networks against a deployed server, the Cloudflare/Render/Supabase deployment itself, native Capacitor builds, and load (how many concurrent rooms a free instance can handle).

## Manual test plan (Phase 10)

Use at least: one desktop browser (Chrome/Edge/Firefox), one Android phone (Chrome), and one iPhone or iPad (Safari). Put at least one on **mobile data** so it is on a different network.

1. **Home:** layout fits the screen, the nickname 🎲 works, and the language switch is remembered after a reload.
2. **Private room:** create on desktop; tap *Share invite* (the system share sheet on mobile); open the link on the phone and join.
3. **Lobby:** the host changes settings and the guest sees them update; a non-host sees no Start button.
4. **Drawing:** on each device as drawer, draw with finger and, where available, with a stylus or Apple Pencil. Check that the page does not scroll while drawing. Try every colour, size, eraser, undo, redo and clear; others should see each change within about 100 ms.
5. **Rotate** the phone mid-turn: the drawing re-renders at the new size.
6. **Guessing:** the close guess hint, case-insensitive matching, letters revealing over time, timer and sounds.
7. **Network loss:** turn on airplane mode for 10 s and off again. The player should be back in the game. Then leave it off for over 45 s: the player is removed, and if they were host, the host moves to someone else.
8. **Moderation:** report, mute for me, host kick and ban (banned player can't rejoin), and vote-kick in a public room with 3 players.
9. **Results:** the podium; *Play again* returns everyone to the lobby with scores reset.
10. **PWA install:** Android Chrome → *Install app*; iOS Safari → *Share → Add to Home Screen*. Launch from the icon.
11. **Leaderboard:** after a finished game, your stats and achievements appear.

## Testing across networks without deploying

Cloudflare Tunnel is free and needs no account for quick tunnels:

```bash
npm run build:client
cd server && npm run build
SERVE_CLIENT_DIR=../client/drawwithsmile-web/dist/drawwithsmile-web/browser \
CLIENT_ORIGINS=https://<random>.trycloudflare.com TRUST_PROXY=1 npm start
cloudflared tunnel --url http://localhost:3000     # prints the https URL
```

The URL changes each run, so set `CLIENT_ORIGINS` to the printed origin and restart the server. Quick tunnels are meant for testing, not production.
