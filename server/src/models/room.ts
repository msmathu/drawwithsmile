import { randomUUID } from 'node:crypto';
import {
  AVATAR_COUNT,
  LIMITS,
  ROOM_REPORTS_TO_UNLIST,
  TIMINGS,
  buildHint,
  cleanText,
  containsWord,
  hintCount,
  hintableIndexes,
  isCloseGuess,
  normalizeGuess,
  splitGraphemes,
  type ChatKind,
  type ChatMessage,
  type ClearOp,
  type DrawOp,
  type GamePhase,
  type PlayerPublic,
  type RoomSettings,
  type RoomState,
  type RoomVisibility,
  type ServerEventName,
  type ServerEventPayload,
  type Standing,
  type StrokeChunk,
  type StrokeOp,
  type TurnEndReason,
  type TurnSummary,
  type WordChoice,
} from '@dws/shared';
import type { GameSummary, ModerationActionType, TurnRecord, WordEntry } from './game-records.js';
import type { WordService } from '../services/word.service.js';
import { drawerAllGuessedBonus, drawerPointsPerGuess, guesserPoints, rankByScore } from '../services/scoring.js';
import { GameError } from '../utils/errors.js';
import { shortId, shuffle } from '../utils/ids.js';
import { censor } from '../utils/profanity.js';

/** How the room talks to the outside world (implemented by the Socket.IO layer). */
export interface RoomOutput {
  toAll<E extends ServerEventName>(event: E, payload: ServerEventPayload<E>, exceptPlayerId?: string): void;
  toPlayers<E extends ServerEventName>(playerIds: readonly string[], event: E, payload: ServerEventPayload<E>): void;
  /** A player left the room; `kickReason` is set when they were removed by moderation. */
  playerRemoved(playerId: string, kickReason: string | null): void;
}

export interface RoomHooks {
  onGameEnd?(summary: GameSummary): void;
  onModeration?(action: { roomCode: string; actorId: string | null; targetId: string; action: ModerationActionType }): void;
  onEmpty?(room: Room): void;
}

export interface RoomMeta {
  /** Display name, unique among active rooms. */
  name: string;
  /** Private rooms: shown in the private room list. */
  listed: boolean;
  /** Player who created the room (accountable for its name). */
  creatorId: string | null;
}

export interface RoomDeps {
  words: WordService;
  output: RoomOutput;
  hooks?: RoomHooks;
}

interface ServerPlayer {
  id: string;
  nickname: string;
  avatar: number;
  score: number;
  connected: boolean;
  removeTimer: NodeJS.Timeout | null;
  hasGuessed: boolean;
  muted: boolean;
  correctGuesses: number;
  drawings: number;
  lastMessage: { text: string; at: number } | null;
}

type RemoveReason = 'left' | 'timeout' | 'kicked' | 'banned' | 'vote-kicked' | 'replaced';

const RECENT_WORDS_LIMIT = 150;
const DUPLICATE_MESSAGE_WINDOW_MS = 4_000;
const PLAYING_PHASES: readonly GamePhase[] = ['choosing', 'drawing', 'turnEnd'];

function avatarFor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % AVATAR_COUNT;
}

/**
 * One game room. Holds all short-lived game state in memory and enforces every
 * rule on the server: who may draw, what counts as a correct guess, scores, timers.
 */
export class Room {
  readonly createdAt = Date.now();
  phase: GamePhase = 'lobby';
  hostId: string | null = null;

  private readonly players = new Map<string, ServerPlayer>();
  private readonly banned = new Set<string>();
  private readonly voteKicks = new Map<string, Set<string>>();
  private readonly recentWords: string[] = [];
  private readonly chatLog: ChatMessage[] = [];

  // Game / turn state
  private sessionId: string | null = null;
  private gameStartedAt: Date | null = null;
  private round = 0;
  private turnNumber = 0;
  private queue: string[] = [];
  private drawerId: string | null = null;
  private choices: WordEntry[] = [];
  private word: WordEntry | null = null;
  private wordGraphemes: string[] = [];
  private readonly revealed = new Set<number>();
  private turnStartedAt = 0;
  private turnDurationMs = 0;
  private phaseEndsAt: number | null = null;
  private correctCount = 0;
  private readonly turnDeltas = new Map<string, number>();
  private lastTurn: TurnSummary | null = null;
  private turns: TurnRecord[] = [];

  // Drawing state for the current turn
  private ops: DrawOp[] = [];
  private redoStack: DrawOp[] = [];
  private readonly usedOpIds = new Set<string>();
  private openStroke: StrokeOp | null = null;
  private totalPoints = 0;

  private readonly phaseTimers = new Set<NodeJS.Timeout>();
  private autoStartTimer: NodeJS.Timeout | null = null;
  private autoStartAt: number | null = null;
  private stateQueued = false;
  private disposed = false;
  private readonly nameReports = new Set<string>();

  readonly name: string;
  readonly creatorId: string | null;
  listed: boolean;

  constructor(
    readonly code: string,
    readonly visibility: RoomVisibility,
    public settings: RoomSettings,
    private readonly deps: RoomDeps,
    meta: Partial<RoomMeta> = {},
  ) {
    this.name = meta.name ?? code;
    this.listed = meta.listed ?? true;
    this.creatorId = meta.creatorId ?? null;
  }

  // ---------------------------------------------------------------- membership

  get size(): number {
    return this.players.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  /**
   * Throws the reason a player could not join right now. Members may always rejoin.
   * Games in progress accept new players: they guess straight away and draw from the next round.
   */
  assertCanJoin(playerId: string): void {
    if (this.disposed) throw new GameError('not-found', 'This room has closed.');
    if (this.players.has(playerId)) return;
    if (this.banned.has(playerId)) throw new GameError('banned', 'You cannot join this room.');
    if (this.players.size >= this.settings.maxPlayers) throw new GameError('room-full', 'This room is full.');
  }

  /** Whether a player could join right now (used by matchmaking). */
  canAccept(playerId: string): boolean {
    try {
      this.assertCanJoin(playerId);
      return true;
    } catch {
      return false;
    }
  }

  /** Adds a player, or reconnects them if they are already a member. */
  join(playerId: string, nickname: string): 'joined' | 'rejoined' {
    this.assertCanJoin(playerId);
    if (this.players.has(playerId)) {
      this.reconnect(playerId);
      return 'rejoined';
    }

    const player: ServerPlayer = {
      id: playerId,
      nickname: this.uniqueNickname(nickname),
      avatar: avatarFor(playerId),
      score: 0,
      connected: true,
      removeTimer: null,
      hasGuessed: false,
      muted: false,
      correctGuesses: 0,
      drawings: 0,
      lastMessage: null,
    };
    this.players.set(playerId, player);
    if (!this.hostId && this.visibility === 'private') this.hostId = playerId;
    this.system(`${player.nickname} joined the room.`);
    this.updateAutoStart();
    this.touch();
    return 'joined';
  }

  reconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) throw new GameError('not-in-room', 'You are not in this room.');
    if (p.removeTimer) clearTimeout(p.removeTimer);
    p.removeTimer = null;
    if (!p.connected) {
      p.connected = true;
      this.system(`${p.nickname} reconnected.`);
    }
    this.updateAutoStart();
    this.touch();
  }

  /** Sends everything a (re)joining client needs to render the current moment. */
  syncPlayer(playerId: string): void {
    const out = this.deps.output;
    out.toPlayers([playerId], 'room:state', this.toState());
    out.toPlayers([playerId], 'chat:history', [...this.chatLog]);
    out.toPlayers([playerId], 'draw:history', this.drawHistory());
    if (playerId === this.drawerId) {
      if (this.phase === 'choosing') {
        out.toPlayers([playerId], 'turn:choices', { choices: this.choices.map(toChoice), remainingMs: this.remainingMs() ?? 0 });
      } else if (this.phase === 'drawing' && this.word) {
        out.toPlayers([playerId], 'turn:word', { word: this.word.text });
      }
    }
  }

  markDisconnected(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    const grace = this.phase === 'lobby' ? TIMINGS.LOBBY_RECONNECT_GRACE_MS : TIMINGS.RECONNECT_GRACE_MS;
    p.removeTimer = setTimeout(() => this.removePlayer(playerId, 'timeout'), grace);
    if (this.phase !== 'lobby') this.system(`${p.nickname} lost connection…`);
    this.updateAutoStart();
    if (this.phase === 'drawing') this.checkAllGuessed();
    this.touch();
  }

  removePlayer(playerId: string, reason: RemoveReason): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.removeTimer) clearTimeout(p.removeTimer);
    this.players.delete(playerId);
    this.voteKicks.delete(playerId);
    for (const votes of this.voteKicks.values()) votes.delete(playerId);
    this.queue = this.queue.filter((id) => id !== playerId);

    const kickReason =
      reason === 'kicked'
        ? 'You were removed from the room by the host.'
        : reason === 'banned'
          ? 'You were banned from this room by the host.'
          : reason === 'vote-kicked'
            ? 'You were removed from the room by a player vote.'
            : null;
    this.deps.output.playerRemoved(playerId, kickReason);

    const verb = reason === 'left' || reason === 'timeout' || reason === 'replaced' ? 'left the room' : 'was removed';
    this.system(`${p.nickname} ${verb}.`);

    if (this.players.size === 0) {
      this.dispose();
      this.deps.hooks?.onEmpty?.(this);
      return;
    }

    if (this.hostId === playerId) {
      const next = [...this.players.values()].find((x) => x.connected) ?? [...this.players.values()][0]!;
      this.hostId = next.id;
      this.system(`${next.nickname} is now the host.`);
    }

    if (PLAYING_PHASES.includes(this.phase)) {
      if (this.players.size < LIMITS.MIN_PLAYERS_TO_START) {
        this.system('Not enough players left — the game is over.');
        this.endGame();
      } else if (this.drawerId === playerId && (this.phase === 'choosing' || this.phase === 'drawing')) {
        this.endTurn('drawer-left');
      } else if (this.phase === 'drawing') {
        this.checkAllGuessed();
      }
    }
    this.updateAutoStart();
    this.touch();
  }

  // ---------------------------------------------------------------- settings & lifecycle

  updateSettings(byId: string, patch: Partial<RoomSettings>): void {
    this.assertHost(byId);
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'Settings can only be changed in the lobby.');
    if (patch.maxPlayers !== undefined && patch.maxPlayers < this.players.size) {
      throw new GameError('bad-request', `There are already ${this.players.size} players in the room.`);
    }
    this.settings = { ...this.settings, ...patch };
    this.touch();
  }

  /** Starts a game. `byId` is null when a public room starts automatically. */
  startGame(byId: string | null): void {
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'The game has already started.');
    if (byId !== null) this.assertHost(byId);
    if (this.connectedCount < LIMITS.MIN_PLAYERS_TO_START) {
      throw new GameError('not-enough-players', `At least ${LIMITS.MIN_PLAYERS_TO_START} players are needed to start.`);
    }
    this.cancelAutoStart();
    this.sessionId = randomUUID();
    this.gameStartedAt = new Date();
    this.turns = [];
    this.round = 0;
    this.turnNumber = 0;
    this.queue = [];
    this.lastTurn = null;
    this.voteKicks.clear();
    for (const p of this.players.values()) {
      p.score = 0;
      p.correctGuesses = 0;
      p.drawings = 0;
    }
    this.system('The game has started. Good luck! 😊');
    this.nextTurn();
  }

  chooseWord(playerId: string, index: number): void {
    if (this.phase !== 'choosing') throw new GameError('wrong-phase', 'It is not time to choose a word.');
    if (playerId !== this.drawerId) throw new GameError('not-drawer', 'Only the drawer can choose the word.');
    if (!Number.isInteger(index) || index < 0 || index >= this.choices.length) {
      throw new GameError('bad-request', 'Invalid word choice.');
    }
    this.beginDrawing(index);
  }

  backToLobby(byId: string | null): void {
    if (this.phase !== 'gameEnd') throw new GameError('wrong-phase', 'The game is not over yet.');
    if (byId !== null) this.assertHost(byId);
    this.clearPhaseTimers();
    this.phase = 'lobby';
    this.phaseEndsAt = null;
    this.lastTurn = null;
    this.round = 0;
    this.resetTurn();
    for (const p of this.players.values()) p.score = 0;
    this.system('Back in the lobby.');
    this.updateAutoStart();
    this.touch();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPhaseTimers();
    this.cancelAutoStart();
    for (const p of this.players.values()) if (p.removeTimer) clearTimeout(p.removeTimer);
  }

  // ---------------------------------------------------------------- chat & guessing

  handleChat(playerId: string, rawText: string): void {
    const p = this.requirePlayer(playerId);
    if (p.muted) throw new GameError('muted', 'The host has muted you in this room.');
    const text = cleanText(rawText).slice(0, LIMITS.CHAT_MAX);
    if (!text) throw new GameError('bad-request', 'Message is empty.');

    const now = Date.now();
    const normalized = normalizeGuess(text);
    if (p.lastMessage && p.lastMessage.text === normalized && now - p.lastMessage.at < DUPLICATE_MESSAGE_WINDOW_MS) {
      throw new GameError('rate-limited', 'Please do not repeat the same message.');
    }
    p.lastMessage = { text: normalized, at: now };

    if (this.phase === 'drawing' && this.word) {
      const word = this.word.text;
      if (playerId === this.drawerId || p.hasGuessed) {
        if (containsWord(text, word)) {
          this.privateMessage(playerId, 'warning', 'Your message was hidden because it contains the word.');
          return;
        }
        const audience = [...this.players.values()].filter((x) => x.id === this.drawerId || x.hasGuessed).map((x) => x.id);
        this.deps.output.toPlayers(audience, 'chat:message', this.message('guessed-chat', censor(text), p));
        return;
      }
      if (normalized === normalizeGuess(word)) {
        this.correctGuess(p);
        return;
      }
      if (containsWord(text, word)) {
        // Shown only to the sender so the answer never leaks to other guessers.
        this.deps.output.toPlayers([playerId], 'chat:message', this.message('chat', text, p));
        return;
      }
      this.broadcast(this.message('chat', censor(text), p));
      if (isCloseGuess(text, word)) this.privateMessage(playerId, 'close', `"${text}" is very close!`);
      return;
    }
    if (this.phase === 'choosing' && playerId === this.drawerId && this.choices.some((w) => containsWord(text, w.text))) {
      this.privateMessage(playerId, 'warning', 'Your message was hidden because it contains one of your words.');
      return;
    }
    this.broadcast(this.message('chat', censor(text), p));
  }

  private correctGuess(p: ServerPlayer): void {
    const word = this.word!;
    const points = guesserPoints({
      remainingMs: this.remainingMs() ?? 0,
      totalMs: this.turnDurationMs,
      order: this.correctCount,
      difficulty: word.difficulty,
    });
    p.hasGuessed = true;
    p.correctGuesses++;
    this.award(p, points);
    const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;
    if (drawer) this.award(drawer, drawerPointsPerGuess(word.difficulty));
    this.correctCount++;

    this.broadcast(this.message('correct', `${p.nickname} guessed the word!`));
    this.privateMessage(p.id, 'system', `You guessed it: "${word.text}" (+${points})`);
    this.touch();
    this.checkAllGuessed();
  }

  private checkAllGuessed(): void {
    if (this.phase !== 'drawing' || !this.word) return;
    const guessers = [...this.players.values()].filter((p) => p.connected && p.id !== this.drawerId);
    if (guessers.length === 0 || !guessers.every((p) => p.hasGuessed)) return;
    const drawer = this.drawerId ? this.players.get(this.drawerId) : undefined;
    if (drawer && this.correctCount > 0) this.award(drawer, drawerAllGuessedBonus(this.word.difficulty));
    this.endTurn('all-guessed');
  }

  // ---------------------------------------------------------------- drawing

  drawChunk(playerId: string, chunk: StrokeChunk): void {
    this.assertDrawing(playerId);
    const pairs = chunk.points.length / 2;
    if (this.totalPoints + pairs > LIMITS.MAX_POINTS_PER_TURN) {
      throw new GameError('bad-request', 'The canvas is full. Clear it or undo to keep drawing.');
    }

    let stroke = this.openStroke;
    if (!stroke || stroke.id !== chunk.id) {
      if (this.usedOpIds.has(chunk.id)) throw new GameError('bad-request', 'Duplicate stroke.');
      if (this.ops.length >= LIMITS.MAX_OPS_PER_TURN) {
        throw new GameError('bad-request', 'The canvas is full. Clear it or undo to keep drawing.');
      }
      stroke = { kind: 'stroke', id: chunk.id, tool: chunk.tool, color: chunk.color, size: chunk.size, points: [] };
      this.ops.push(stroke);
      this.usedOpIds.add(chunk.id);
      this.redoStack = [];
      this.openStroke = stroke;
    } else if (stroke.points.length / 2 + pairs > LIMITS.STROKE_MAX_POINTS) {
      throw new GameError('bad-request', 'Stroke is too long.');
    }

    stroke.points.push(...chunk.points);
    this.totalPoints += pairs;
    if (chunk.final) this.openStroke = null;
    // Continuation chunks always carry the stroke's original style.
    this.deps.output.toAll(
      'draw:chunk',
      { id: stroke.id, tool: stroke.tool, color: stroke.color, size: stroke.size, points: chunk.points, final: chunk.final },
      playerId,
    );
  }

  undo(playerId: string): void {
    this.assertDrawing(playerId);
    this.openStroke = null;
    const op = this.ops.pop();
    if (!op) return;
    this.redoStack.push(op);
    this.deps.output.toAll('draw:undo', { opId: op.id });
  }

  redo(playerId: string): void {
    this.assertDrawing(playerId);
    this.openStroke = null;
    const op = this.redoStack.pop();
    if (!op) return;
    this.ops.push(op);
    this.deps.output.toAll('draw:redo', op);
  }

  clear(playerId: string): void {
    this.assertDrawing(playerId);
    this.openStroke = null;
    if (this.ops.length === 0 || this.ops[this.ops.length - 1]!.kind === 'clear') return;
    if (this.ops.length >= LIMITS.MAX_OPS_PER_TURN) this.ops = [];
    const op: ClearOp = { kind: 'clear', id: shortId() };
    this.ops.push(op);
    this.usedOpIds.add(op.id);
    this.redoStack = [];
    this.deps.output.toAll('draw:clear', op);
  }

  drawHistory(): DrawOp[] {
    return this.ops.map((op) => (op.kind === 'stroke' ? { ...op, points: [...op.points] } : { ...op }));
  }

  isDrawer(playerId: string): boolean {
    return this.drawerId === playerId;
  }

  // ---------------------------------------------------------------- moderation

  kick(byId: string, targetId: string, ban: boolean): void {
    if (this.visibility !== 'private') throw new GameError('bad-request', 'Use vote-kick in public rooms.');
    this.assertHost(byId);
    if (byId === targetId) throw new GameError('bad-request', 'You cannot remove yourself.');
    this.requirePlayer(targetId);
    if (ban) this.banned.add(targetId);
    this.deps.hooks?.onModeration?.({ roomCode: this.code, actorId: byId, targetId, action: ban ? 'ban' : 'kick' });
    this.removePlayer(targetId, ban ? 'banned' : 'kicked');
  }

  setMuted(byId: string, targetId: string, muted: boolean): void {
    this.assertHost(byId);
    if (byId === targetId) throw new GameError('bad-request', 'You cannot mute yourself.');
    const target = this.requirePlayer(targetId);
    if (target.muted === muted) return;
    target.muted = muted;
    this.deps.hooks?.onModeration?.({ roomCode: this.code, actorId: byId, targetId, action: muted ? 'mute' : 'unmute' });
    this.system(`${target.nickname} was ${muted ? 'muted' : 'unmuted'} by the host.`);
    this.touch();
  }

  voteKick(voterId: string, targetId: string): void {
    if (this.visibility !== 'public') throw new GameError('bad-request', 'Vote-kick is only available in public rooms.');
    const voter = this.requirePlayer(voterId);
    const target = this.requirePlayer(targetId);
    if (voterId === targetId) throw new GameError('bad-request', 'You cannot vote against yourself.');
    const votes = this.voteKicks.get(targetId) ?? new Set<string>();
    if (votes.has(voterId)) throw new GameError('bad-request', 'You already voted.');
    votes.add(voterId);
    this.voteKicks.set(targetId, votes);
    const needed = this.votesNeeded();
    this.system(`${voter.nickname} voted to kick ${target.nickname} (${votes.size}/${needed}).`);
    if (votes.size >= needed) {
      this.banned.add(targetId);
      this.deps.hooks?.onModeration?.({ roomCode: this.code, actorId: null, targetId, action: 'vote-kick' });
      this.removePlayer(targetId, 'vote-kicked');
    }
    this.touch();
  }

  /**
   * Records a report about the room name. After enough distinct reports the room is
   * hidden from the room lists (it keeps working for people already in it).
   * Returns true the first time a reporter reports this room.
   */
  reportName(reporterId: string): boolean {
    if (this.nameReports.has(reporterId)) return false;
    this.nameReports.add(reporterId);
    if (this.nameReports.size >= ROOM_REPORTS_TO_UNLIST) this.listed = false;
    return true;
  }

  playerNickname(playerId: string): string | null {
    return this.players.get(playerId)?.nickname ?? null;
  }

  private votesNeeded(): number {
    const eligible = Math.max(0, this.connectedCount - 1);
    return Math.max(2, Math.floor(eligible / 2) + 1);
  }

  // ---------------------------------------------------------------- turn flow

  private nextTurn(): void {
    if (this.disposed) return;
    this.clearPhaseTimers();
    this.resetTurn();

    if (this.connectedCount < LIMITS.MIN_PLAYERS_TO_START) {
      this.system('Not enough players connected — the game is over.');
      this.endGame();
      return;
    }

    let next = this.takeNextDrawer();
    if (!next) {
      this.round++;
      if (this.round > this.settings.rounds) {
        this.endGame();
        return;
      }
      this.queue = [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
      next = this.takeNextDrawer();
      if (!next) {
        this.endGame();
        return;
      }
      this.system(`Round ${this.round} of ${this.settings.rounds}`);
    }

    this.drawerId = next.id;
    this.turnNumber++;
    this.choices = this.deps.words.pickChoices({
      language: this.settings.language,
      difficulty: this.settings.difficulty,
      categories: this.settings.categories,
      exclude: new Set(this.recentWords),
    });
    if (this.choices.length === 0) {
      this.system('No words are available for these settings.');
      this.endGame();
      return;
    }
    this.phase = 'choosing';
    this.phaseEndsAt = Date.now() + TIMINGS.CHOOSE_WORD_MS;
    this.deps.output.toPlayers([next.id], 'turn:choices', {
      choices: this.choices.map(toChoice),
      remainingMs: TIMINGS.CHOOSE_WORD_MS,
    });
    this.system(`${next.nickname} is choosing a word…`);
    this.schedule(TIMINGS.CHOOSE_WORD_MS, () => this.beginDrawing(Math.floor(Math.random() * this.choices.length)));
    this.touch();
  }

  private takeNextDrawer(): ServerPlayer | undefined {
    while (this.queue.length > 0) {
      const p = this.players.get(this.queue.shift()!);
      if (p?.connected) return p;
    }
    return undefined;
  }

  private beginDrawing(index: number): void {
    const word = this.choices[index];
    if (this.phase !== 'choosing' || !word) return;
    this.clearPhaseTimers();
    this.word = word;
    this.wordGraphemes = splitGraphemes(word.text);
    this.choices = [];
    this.recentWords.push(normalizeGuess(word.text));
    if (this.recentWords.length > RECENT_WORDS_LIMIT) this.recentWords.shift();

    const drawer = this.players.get(this.drawerId!);
    if (drawer) drawer.drawings++;
    this.phase = 'drawing';
    this.turnStartedAt = Date.now();
    this.turnDurationMs = this.settings.drawTime * 1000;
    this.phaseEndsAt = this.turnStartedAt + this.turnDurationMs;

    const hints = hintCount(word.text);
    const order = shuffle(hintableIndexes(word.text));
    for (let k = 1; k <= hints; k++) {
      const index = order[k - 1];
      if (index === undefined) break;
      this.schedule(this.turnDurationMs * (0.4 + (0.45 * k) / (hints + 1)), () => {
        this.revealed.add(index);
        this.touch();
      });
    }
    this.schedule(this.turnDurationMs, () => this.endTurn('time-up'));

    this.deps.output.toPlayers([this.drawerId!], 'turn:word', { word: word.text });
    this.system(`${drawer?.nickname ?? 'The drawer'} is drawing now!`);
    this.touch();
  }

  private endTurn(reason: TurnEndReason): void {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.clearPhaseTimers();
    const word = this.word;
    if (word && this.drawerId) {
      this.turns.push({
        round: this.round,
        turnNumber: this.turnNumber,
        drawerId: this.drawerId,
        wordId: word.id,
        wordText: word.text,
        correctGuesses: this.correctCount,
        endReason: reason,
        startedAt: new Date(this.turnStartedAt),
        endedAt: new Date(),
      });
      this.system(`The word was "${word.text}".`);
    } else {
      this.system('The drawer left, so this turn was skipped.');
    }
    this.lastTurn = {
      word: word?.text ?? '',
      drawerId: this.drawerId ?? '',
      deltas: Object.fromEntries(this.turnDeltas),
      reason,
    };
    this.phase = 'turnEnd';
    this.phaseEndsAt = Date.now() + TIMINGS.TURN_END_MS;
    this.schedule(TIMINGS.TURN_END_MS, () => this.nextTurn());
    this.touch();
  }

  private endGame(): void {
    this.clearPhaseTimers();
    const completed = this.round > this.settings.rounds;
    this.resetTurn();
    this.phase = 'gameEnd';
    this.phaseEndsAt = Date.now() + TIMINGS.GAME_END_RETURN_MS;

    const standings = this.standings();
    const winner = standings[0];
    if (winner && winner.score > 0) this.system(`🏆 ${winner.nickname} wins with ${winner.score} points!`);

    if (this.turns.length > 0 && this.sessionId && this.gameStartedAt) {
      this.deps.hooks?.onGameEnd?.({
        sessionId: this.sessionId,
        roomCode: this.code,
        visibility: this.visibility,
        language: this.settings.language,
        totalRounds: this.settings.rounds,
        drawTime: this.settings.drawTime,
        completed,
        startedAt: this.gameStartedAt,
        endedAt: new Date(),
        turns: [...this.turns],
        players: standings.map((s) => {
          const p = this.players.get(s.playerId)!;
          return {
            playerId: s.playerId,
            nickname: s.nickname,
            finalScore: s.score,
            rank: s.rank,
            correctGuesses: p.correctGuesses,
            drawings: p.drawings,
            isWinner: s.rank === 1 && s.score > 0,
          };
        }),
      });
    }
    this.sessionId = null;
    this.schedule(TIMINGS.GAME_END_RETURN_MS, () => this.backToLobby(null));
    this.touch();
  }

  private resetTurn(): void {
    this.drawerId = null;
    this.word = null;
    this.wordGraphemes = [];
    this.choices = [];
    this.revealed.clear();
    this.correctCount = 0;
    this.turnDeltas.clear();
    this.ops = [];
    this.redoStack = [];
    this.usedOpIds.clear();
    this.openStroke = null;
    this.totalPoints = 0;
    for (const p of this.players.values()) p.hasGuessed = false;
    this.deps.output.toAll('draw:history', []);
  }

  // ---------------------------------------------------------------- public lobbies

  private updateAutoStart(): void {
    if (this.visibility !== 'public' || this.phase !== 'lobby' || this.disposed) {
      this.cancelAutoStart();
      return;
    }
    const connected = this.connectedCount;
    if (connected < LIMITS.MIN_PLAYERS_TO_START) {
      this.cancelAutoStart();
      return;
    }
    const delay = connected >= this.settings.maxPlayers ? TIMINGS.PUBLIC_FULL_AUTOSTART_MS : TIMINGS.PUBLIC_AUTOSTART_MS;
    const target = Date.now() + delay;
    if (this.autoStartAt !== null && this.autoStartAt <= target) return;
    this.cancelAutoStart();
    this.autoStartAt = target;
    this.autoStartTimer = setTimeout(() => {
      this.autoStartTimer = null;
      this.autoStartAt = null;
      if (this.phase === 'lobby' && this.connectedCount >= LIMITS.MIN_PLAYERS_TO_START) this.startGame(null);
      else this.touch();
    }, delay);
  }

  private cancelAutoStart(): void {
    if (this.autoStartTimer) clearTimeout(this.autoStartTimer);
    this.autoStartTimer = null;
    this.autoStartAt = null;
  }

  // ---------------------------------------------------------------- state

  toState(): RoomState {
    const now = Date.now();
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      score: p.score,
      isHost: p.id === this.hostId,
      connected: p.connected,
      hasGuessed: p.hasGuessed,
      isDrawer: p.id === this.drawerId,
      muted: p.muted,
    }));
    let hint: (string | null)[] | null = null;
    if (this.phase === 'drawing' && this.word) hint = buildHint(this.word.text, this.revealed);
    else if (this.phase === 'turnEnd' && this.lastTurn?.word) hint = splitGraphemes(this.lastTurn.word);

    const voteKicks: Record<string, number> = {};
    for (const [id, votes] of this.voteKicks) if (votes.size > 0) voteKicks[id] = votes.size;

    return {
      code: this.code,
      name: this.name,
      visibility: this.visibility,
      listed: this.listed,
      phase: this.phase,
      settings: { ...this.settings, categories: [...this.settings.categories] },
      players,
      hostId: this.hostId,
      round: this.round,
      totalRounds: this.settings.rounds,
      drawerId: this.drawerId,
      hint,
      phaseRemainingMs: this.remainingMs(),
      autoStartInMs: this.autoStartAt === null ? null : Math.max(0, this.autoStartAt - now),
      lastTurn: this.phase === 'turnEnd' ? this.lastTurn : null,
      standings: this.phase === 'gameEnd' ? this.standings() : null,
      voteKicks,
      votesNeeded: this.votesNeeded(),
    };
  }

  /** Current secret word; only for tests and server-side checks. */
  get currentWord(): string | null {
    return this.word?.text ?? null;
  }

  get currentChoices(): readonly WordEntry[] {
    return this.choices;
  }

  get currentDrawerId(): string | null {
    return this.drawerId;
  }

  get currentRound(): number {
    return this.round;
  }

  private standings(): Standing[] {
    return rankByScore(
      [...this.players.values()].map((p) => ({ playerId: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score })),
    );
  }

  private remainingMs(): number | null {
    return this.phaseEndsAt === null ? null : Math.max(0, this.phaseEndsAt - Date.now());
  }

  /** Coalesces many changes in one tick into a single state broadcast. */
  private touch(): void {
    if (this.stateQueued || this.disposed) return;
    this.stateQueued = true;
    queueMicrotask(() => {
      this.stateQueued = false;
      if (!this.disposed) this.deps.output.toAll('room:state', this.toState());
    });
  }

  // ---------------------------------------------------------------- helpers

  private award(p: ServerPlayer, points: number): void {
    p.score += points;
    this.turnDeltas.set(p.id, (this.turnDeltas.get(p.id) ?? 0) + points);
  }

  private schedule(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.phaseTimers.delete(timer);
      if (!this.disposed) fn();
    }, ms);
    this.phaseTimers.add(timer);
  }

  private clearPhaseTimers(): void {
    for (const t of this.phaseTimers) clearTimeout(t);
    this.phaseTimers.clear();
  }

  private requirePlayer(playerId: string): ServerPlayer {
    const p = this.players.get(playerId);
    if (!p) throw new GameError('not-in-room', 'That player is not in this room.');
    return p;
  }

  private assertHost(playerId: string): void {
    this.requirePlayer(playerId);
    if (this.visibility !== 'private' || this.hostId !== playerId) {
      throw new GameError('not-host', 'Only the host can do that.');
    }
  }

  private assertDrawing(playerId: string): void {
    if (this.phase !== 'drawing' || playerId !== this.drawerId) {
      throw new GameError('not-drawer', 'Only the current drawer can draw.');
    }
  }

  private uniqueNickname(nickname: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.nickname.toLocaleLowerCase()));
    if (!taken.has(nickname.toLocaleLowerCase())) return nickname;
    for (let i = 2; i < 20; i++) {
      const candidate = `${nickname} ${i}`;
      if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `${nickname} ${shortId().slice(0, 3)}`;
  }

  private message(kind: ChatKind, text: string, from?: ServerPlayer): ChatMessage {
    return { id: shortId(), kind, text, ts: Date.now(), playerId: from?.id, nickname: from?.nickname };
  }

  private broadcast(message: ChatMessage): void {
    this.chatLog.push(message);
    if (this.chatLog.length > LIMITS.CHAT_HISTORY) this.chatLog.shift();
    this.deps.output.toAll('chat:message', message);
  }

  private system(text: string): void {
    this.broadcast(this.message('system', text));
  }

  private privateMessage(playerId: string, kind: ChatKind, text: string): void {
    this.deps.output.toPlayers([playerId], 'chat:message', this.message(kind, text));
  }
}

function toChoice(word: WordEntry): WordChoice {
  return { text: word.text, difficulty: word.difficulty, category: word.category };
}

