# Architecture

```
 Browser / PWA / Capacitor app                         Render (free web service)
┌───────────────────────────────┐   HTTPS  /api/*    ┌───────────────────────────────────────┐
│ Angular 22 (signals, zoneless)│ ─────────────────▶ │ Express  (session, health, leaderboard)│
│  GameService  (state store)   │                    │                                         │
│  DrawingService + engine      │   WSS  socket.io   │ Socket.IO ── auth (signed guest token)  │
│  SocketService (typed)        │ ◀────────────────▶ │   │  zod validation + rate limits       │
└───────────────────────────────┘                    │   ▼                                     │
        ▲ static files                               │ RoomManager ─▶ Room (state machine)     │
        │                                            │   in-memory: players, turn, strokes     │
 Cloudflare Pages (free CDN)                         │   │ game end / reports (async)          │
                                                     │   ▼                                     │
                                                     │ PersistenceService ─▶ Postgres           │
                                                     └──────────────────────────┬──────────────┘
                                                                                │ session pooler :5432
                                                                     Supabase Postgres (free)
```

## Shared contracts

`@dws/shared` defines every Socket.IO event in both directions (`ServerToClientEvents`, `ClientToServerEvents`), the shared types (`RoomState`, `StrokeChunk`, …), the limits and the text helpers. The server's `Server<…>` and the client's `Socket<…>` are typed with these interfaces, so a renamed event or a changed payload is a compile error on both sides.

## Game state (server-authoritative)

`server/src/models/room.ts` holds every rule. It has no Socket.IO dependency: it talks through a `RoomOutput` interface, which is what lets the tests drive it with fake timers.

Phases: `lobby → choosing → drawing → turnEnd → (choosing …) → gameEnd → lobby`.

- **Turn order:** at the start of each round, the connected players are queued in join order. Disconnected players are skipped.
- **Words:** the drawer gets 3 choices (one per difficulty in "mixed" mode) from the room's language and categories. The last 150 words used in the room are avoided. If the drawer doesn't choose within 15 s, a word is picked automatically.
- **Secrecy:** only the drawer receives `turn:word`. Everyone else gets a masked `hint` array split by grapheme, so Tamil letters such as "கா" count as one letter. Letters are revealed at scheduled times.
- **Guessing:** guesses are normalised (Unicode NFC, case-insensitive, whitespace/punctuation tolerant). A correct guess is never broadcast; others see "X guessed the word!". A message that only *contains* the word is shown only to its sender. Players who have guessed, and the drawer, chat in a channel only they can see.
- **Scoring** (`services/scoring.ts`): guesser gets `(50 + 100 × timeLeft/total + order bonus 30/20/10) × difficulty multiplier (1 / 1.2 / 1.5)`. Drawer gets 25 × multiplier per correct guess, plus 50 × multiplier if everyone guessed.
- **Turn end:** when time runs out, everyone guesses, or the drawer leaves. The game ends after all rounds, or when fewer than 2 players remain.

## Rooms, names and the room browser

- Every room has an unguessable 8-character **code** and a unique display **name**. The name is either random ("The Kitten Room", "The Kitten Room2" if taken) or custom (3–24 characters, profanity-filtered).
- `GET /api/rooms` returns the public rooms, the *listed* private rooms (up to 100 each) and totals; the home page polls it every 5 s. Unlisted private rooms are counted but their name and code are never exposed.
- `room:joinByName` accepts a room name (public or listed private rooms) or any room code.
- Quick Play prefers fuller public rooms that are waiting or in an early round, and never puts players into a room that is finishing.
- **Late join:** rooms accept new players in any phase until they are full. A late joiner gets the current state, chat and drawing history, can guess immediately and enters the drawer rotation at the next round.
- **Room-name reports** (`mod:reportRoom`) are stored against the room creator. After 3 distinct reports the room is hidden from the lists.

## Game modes (all server-authoritative)

| Feature | Where the rules live | Notes |
| --- | --- | --- |
| Custom room rules | `RoomSettings` + `validateSettings()` (shared), `settingsSchema` (server) | Ranges are checked by zod and combinations by `validateSettings`. Rules can only change in the lobby, and only the host can change them. |
| Chaos Drawing | `Room.rollChaos()`, `assertChaosColour`, one-stroke checks | Each turn's `ChaosTurn` is public. The server enforces the palette and the one-stroke rule (no fill, undo or clear). Invisible ink, mirroring and the wobbly brush are input effects applied by the drawer's client. |
| Multiple artists | `Room.artists`, `passPen`, `startPen` | Every artist gets the word. Only `currentArtistId` may draw. The pen passes on a timer, on request, or when the holder disconnects. The canvas is never reset between artists. At least one guesser always remains. |
| Reactions & voting | `Room.react`, `startVoting`, `castVote`, `closeVoting` | The vote is a `voting` phase after each round. It rejects self-votes, duplicate votes and votes after the deadline, and closes early once everyone has voted. Thumbnails are captured by each client, so the server never stores images. |
| Team Battle | `joinTeam`, `balanceTeams`, `teamsPublic`, `buildQueue` | Teams alternate as drawers. Team score is the members' total or average plus the team bonus. Teams rebalance in the lobby (auto mode), and late joiners go to the smallest team. |
| Language Battle | `WordService.pickChoices`, `isCorrectGuess`, `words.accepted` | Mixed mode spreads the three choices across languages. Accepted answers are curated in the seed list. Normalisation is NFC plus case/space handling and never strips Tamil vowel signs or the pulli. To add a language: add its code to `Language`/`WORD_LANGUAGES` and `LANGUAGES`, add category labels, and add words in `server/seeds/words.ts`. Migration 004 already allows new language codes. |
| Avatars & titles | `ProfileService`, `ACHIEVEMENT_RULES` SQL, `/api/me/profile` | Unlocks are computed from achievements stored by the server, and the API rejects locked choices. The chosen look is cached and pushed into the player's room live. |

## Drawing protocol

- Coordinates are integers in `0..10000` relative to a fixed 4:3 canvas. Brush size is relative to an 800 px reference width. Any screen size renders the same picture, and resizing just re-renders from history.
- The drawer renders locally at once and streams `draw:chunk` messages: up to 120 points, sent every 50 ms. The first chunk with a new id starts a stroke. The server validates each chunk (palette colour, allowed size, integer range, length), appends it to the turn history and forwards it to everyone except the drawer.
- **Fill (paint bucket)** is sent as one small op `{color, x, y}`, not as pixels. Every client runs the same scanline flood fill at its own resolution, and replays fills in order when redrawing. The server caps fills at 60 per turn.
- The lobby **practice canvas** uses a separate, local-only DrawingService instance. Nothing from it is sent to the server.
- Undo, redo and clear are server operations broadcast to everyone. Clear is a history entry, so it can be undone. Limits per turn: 1,500 operations, 2,400 points per stroke, 60,000 points total. Socket messages are capped at 16 KB.
- If the server rejects the drawer's input, it sends the authoritative `draw:history` back so the drawer's screen resyncs.
- Mouse movements are **never** written to the database.

## Identity and reconnection

- `POST /api/session` issues `v1.<uuid>.<HMAC-SHA256>`. The client stores it in `localStorage` and sends it in the Socket.IO handshake. The server derives the player id from the verified token and never trusts a client-supplied id. Tokens are stateless, so they survive restarts.
- One live socket per player. A second tab takes over the session, and the old tab is told.
- When a socket disconnects, the player stays in the room, marked offline, for a grace period: 20 s in the lobby, 45 s in a game. On reconnect the server rejoins them automatically and sends state, recent chat, drawing history and, for the drawer, their word or choices. A page refresh works the same way. After the grace period the player is removed. If they were host, the next player becomes host; if they were drawing, the turn ends.
- After every reconnect the client also re-sends `room:join`. That call is idempotent, and if the room no longer exists (server restarted) the player is sent home with a message.

## Persistence

Only the following is stored in Postgres: words and categories, finished games (`game_sessions`, `game_rounds`, `player_results`), aggregated `player_stats`, `achievements` / `player_achievements`, `reports` and `moderation_actions`. Writes happen asynchronously after a game ends. A database outage is logged and never interrupts play. If the DB is unreachable at startup, the built-in word list is used.

## Scaling beyond one instance

The current in-memory design **does not work across multiple server instances**. Two players connected to different instances would be in different `RoomManager`s. To scale out you would need:

1. **Sticky routing by room.** Either route each room code to a fixed instance (consistent hashing at the proxy, or a `room → instance` lookup in Redis), or
2. **Shared state.** Move room state to Redis, with Lua scripts or a single "room owner" instance plus a lease, and add `@socket.io/redis-adapter` so broadcasts reach sockets on any instance.
3. **Sticky sessions** for the HTTP long-polling fallback, or force WebSocket-only transport.
4. **Timers** (turn end, hints) must have exactly one owner per room. That fits the "room owner" model better than fully shared state.

The recommended path is room-owner sharding: it keeps the simple in-memory `Room` class and adds a thin routing layer. None of this is possible on Render Free, which is limited to a single instance.
