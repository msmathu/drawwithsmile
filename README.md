# DrawWithSmile 😊✏️

**Draw it. Guess it. Smile!** A free, open-source, real-time multiplayer drawing and guessing game that runs in any modern browser on desktop, Android and iOS, and installs as a Progressive Web App.

- **Room browser:** a live list of public rooms with names and status ("Waiting for players", "Playing round 2 of 3", "Finishing game") and player counts, plus players-online and room/player totals.
- **Create Room dialog:** Public or Private, a random name ("The Kitten Room") or a custom one, and a Max Players slider from 4 to 16.
- **Quick Play:** automatic matchmaking into public rooms (English or Tamil words), including games already in progress.
- **Private rooms:** join by room name or 8-character code / invite link. "View all private rooms" has search and room-name reporting. A private room can be hidden from the list (invite only). The host controls settings and can kick, ban or mute.
- **Join any time:** new players can enter a game in progress. They guess right away and draw from the next round.
- **Server-authoritative game:** word choice, masked hints, guess checking, timers, scoring and drawer rotation all run on the server.
- **Drawing tools:** 16 colours, 5 brush sizes, eraser, undo, redo and clear. Mouse, touch and stylus all work through Pointer Events.
- **Recovery:** players can reconnect, refresh mid-turn and keep the drawing, and get the history if they rejoin late.
- **Progress:** guest profiles with no sign-up, game history, a leaderboard, statistics and achievements.
- **Moderation:** chat filter, rate limits, reports, mute for me, host kick/ban/mute, and vote-kick in public rooms.
- **Budget: $0.** Everything uses open-source software and free hosting tiers.

## Project layout

```
drawwithsmile/
├─ shared/                    @dws/shared: typed Socket.IO contracts, constants, text helpers
├─ server/                    Node.js + TypeScript + Express + Socket.IO
│  ├─ src/
│  │  ├─ config/              environment parsing (zod)
│  │  ├─ controllers/         REST handlers
│  │  ├─ database/            Postgres/PGlite adapters, migrator, seeder, repositories, CLI
│  │  ├─ middleware/          auth, rate limit, error handling
│  │  ├─ models/              Room state machine (all game rules), records
│  │  ├─ routes/              /api routes
│  │  ├─ services/            room manager, words, scoring, sessions, persistence
│  │  ├─ sockets/             Socket.IO server + payload schemas
│  │  └─ utils/               logger, rate limiter, profanity filter, ids, errors
│  ├─ migrations/             numbered SQL migrations
│  ├─ seeds/                  curated English + Tamil word list
│  └─ test/                   unit + integration tests (Vitest)
├─ client/drawwithsmile-web/  Angular 22 (standalone, signals, zoneless) PWA
│  └─ src/app/
│     ├─ core/                services (socket, session, game store…) + drawing engine
│     ├─ shared/components/   canvas, toolbar, chat, player list, hint, timer, logo, avatar
│     └─ pages/               home, room (shell), lobby, game-room, results, leaderboard, how-to-play
├─ docs/                      architecture, deployment, security, testing
├─ render.yaml                Render blueprint (backend)
└─ .env.example               configuration template (placeholders only)
```

The suggested structure had `services/` and `models/` at the client root. Here they live in `core/`, and the model types come from the `shared` package so client and server cannot drift apart.

## Requirements

- Node.js **22 LTS or 24 LTS** (`.node-version` pins 22 for hosts). It also worked on Node 25 during development, with warnings.
- npm 10+. No database install is needed for local development.

## Run locally

```bash
npm install                 # installs all workspaces
cp .env.example server/.env # optional; the defaults work locally
npm run build:shared

npm run dev:server          # http://localhost:3000  (embedded Postgres via PGlite in server/.data)
npm run dev:client          # http://localhost:4200  (proxies /api and /socket.io to :3000)
```

Open http://localhost:4200 in two different browsers, or one normal window and one private window, to play against yourself.

**Local database:** without `DATABASE_URL` the server uses [PGlite](https://pglite.dev), which is real PostgreSQL compiled to WebAssembly and stored in `server/.data/pglite`. The same migrations and SQL run on it as on Supabase. Migrations and the word seed run automatically on start. You can also run them by hand: `npm run db:migrate` / `npm run db:seed`.

**Play on your LAN or share a quick test link** (single origin, production build):

```bash
npm run build:client
cd server && npm run build
SERVE_CLIENT_DIR=../client/drawwithsmile-web/dist/drawwithsmile-web/browser CLIENT_ORIGINS=http://<your-lan-ip>:3000 npm start
```

Then open `http://<your-lan-ip>:3000` on phones on the same Wi-Fi. For players on other networks, see the tunnel option in [docs/TESTING.md](docs/TESTING.md).

## Tests

```bash
npm test               # shared + server + client
npm run test:server    # unit tests + Socket.IO integration tests on in-memory Postgres
npm run test:client    # Angular component/unit tests (Vitest)
```

What is covered:

| Area | Where |
| --- | --- |
| Scoring, ranking, rate limiter, sessions, words, profanity, IP handling | `server/test/services.spec.ts` |
| Room state machine: joining, host reassignment, reconnect grace, turns, hints, time-up, all-guessed, game end, chat visibility, drawing permissions, undo/redo/clear, auto-start, vote-kick, kick/ban | `server/test/room.spec.ts` |
| Payload validation | `server/test/validation.spec.ts` |
| Integration: REST, socket auth, private join, quick-play matching, drawer permissions, correct guess, reconnect, kick/ban, persistence + achievements + leaderboard | `server/test/integration.spec.ts` |
| Text normalisation, Tamil graphemes, hints | `shared/src/text.spec.ts` |
| Drawing engine, safe chat rendering, word hint | `client/.../*.spec.ts` |

## Deploy for $0

The short version is below. Every step is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

1. **Supabase (free):** create a project and copy the **session pooler** connection string (port 5432).
2. **Render (free web service):** create a Blueprint from `render.yaml`. Set `DATABASE_URL` and `CLIENT_ORIGINS`.
3. **Cloudflare Pages (free):** build command `npm ci && npm run build:client`, output `client/drawwithsmile-web/dist/drawwithsmile-web/browser`, env `DWS_API_URL=https://<your-render-service>.onrender.com`.

## Documentation

- [Architecture, room state, reconnection and scaling](docs/ARCHITECTURE.md)
- [Free-tier deployment guide + limits](docs/DEPLOYMENT.md)
- [Security checklist](docs/SECURITY.md)
- [Testing guide (desktop, Android, iOS, other networks)](docs/TESTING.md)

## Known limitations

- **Single server instance.** Rooms live in memory, so a restart or redeploy ends games in progress. Render Free also sleeps after 15 minutes idle, and the first visitor then waits about a minute. Scaling out needs the changes described in ARCHITECTURE.md.
- **Capacity has not been load-tested.** Real use has been verified for 2 browsers per room. The 8-player limit is enforced and covered by tests, but the number of concurrent rooms a free instance can handle is unknown until measured.
- **Listed private rooms can be joined by anyone who sees the list** (the same as Drawasaurus). Untick "Show in the private room list" for an invite-only room. There is no spectator-only mode: anyone who joins is a player.
- **The profanity filter is a small English list.** Tamil chat is not filtered beyond rate limits, and reports are stored but there is no admin UI yet; review them in Supabase's table editor.
- **Optional accounts are not implemented.** Progress is tied to a browser's guest token. Clearing site data creates a new guest.
- **Capacitor:** a config file is included, but no native builds were produced or tested.

## Future improvements

Redis adapter + sticky sessions for multiple instances. Spectator mode. Fill/bucket tool. An admin dashboard for reports. Larger community word lists and more languages. Optional accounts (for example with Supabase Auth's free tier) to sync progress across devices. Custom word packs for private rooms. Load testing with a socket bot script.

## License

MIT. Fonts: Baloo Thambi 2 (SIL Open Font License) via Google Fonts. All artwork is original SVG/CSS.
