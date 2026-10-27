import { randomInt, randomUUID } from 'node:crypto';
import {
  CHAOS_RULES,
  CHAOS_RULE_IDS,
  LIMITS,
  PALETTE,
  REACTIONS,
  ROOM_REPORTS_TO_UNLIST,
  TEAMS,
  TIMINGS,
  VOTE_CATEGORIES,
  buildHint,
  cleanText,
  containsWord,
  hintCount,
  hintableIndexes,
  isCloseGuess,
  isCorrectGuess,
  normalizeGuess,
  splitGraphemes,
  validateSettings,
  type ChaosRule,
  type ChaosTurn,
  type ChatKind,
  type ChatMessage,
  type ClearOp,
  type DrawOp,
  type FillOp,
  type GamePhase,
  type PlayerPublic,
  type ReactionEmoji,
  type RoomSettings,
  type RoomState,
  type RoomVisibility,
  type ServerEventName,
  type ServerEventPayload,
  type Standing,
  type StrokeChunk,
  type StrokeOp,
  type TeamPublic,
  type TurnEndReason,
  type TurnSummary,
  type VoteCandidate,
  type VoteCategory,
  type VoteWinner,
  type WordChoice,
} from '@dws/shared';
import type { GameSummary, ModerationActionType, PlayerGameStats, TurnRecord, WordEntry } from './game-records.js';
import type { WordService } from '../services/word.service.js';
import { drawerAllGuessedBonus, drawerPointsPerGuess, guesserPoints, rankByScore } from '../services/scoring.js';
import { defaultAvatar } from '../utils/avatar.js';
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

/** Cosmetics chosen by the player (validated by the ProfileService before reaching the room). */
export interface PlayerLook {
  avatar: number;
  title: string | null;
}

interface ServerPlayer {
  id: string;
  nickname: string;
  avatar: number;
  title: string | null;
  score: number;
  connected: boolean;
  removeTimer: NodeJS.Timeout | null;
  hasGuessed: boolean;
  muted: boolean;
  team: number | null;
  lastMessage: { text: string; at: number } | null;
  stats: PlayerGameStats;
  /** Hashed public IP (null on shared/private networks), used for room bans. */
  ipKey: string | null;
}

interface VotingState {
  candidates: VoteCandidate[];
  categories: VoteCategory[];
  /** voter id -> category -> turn number */
  votes: Map<string, Map<VoteCategory, number>>;
  closed: boolean;
  winners: VoteWinner[] | null;
}

type RemoveReason = 'left' | 'timeout' | 'kicked' | 'banned' | 'vote-kicked' | 'replaced' | 'auto-banned';

const RECENT_WORDS_LIMIT = 150;
const DUPLICATE_MESSAGE_WINDOW_MS = 4_000;
const PLAYING_PHASES: readonly GamePhase[] = ['choosing', 'drawing', 'turnEnd', 'voting'];
const LIMITED_PALETTE_SIZE = 4;

function emptyStats(): PlayerGameStats {
  return { correctGuesses: 0, drawings: 0, quickGuesses: 0, perfectDrawings: 0, collabDrawings: 0, chaosTurns: 0, votesReceived: 0 };
}

/**
 * True when `text` mentions an answer. Short answers (≤ 3 letters, e.g. "tv") must
 * appear as a whole word so ordinary messages aren't caught by accident.
 */
function mentionsAnswer(text: string, answer: string): boolean {
  const a = normalizeGuess(answer);
  if (splitGraphemes(a.replace(/ /g, '')).length <= 3) return normalizeGuess(text).split(' ').includes(a);
  return containsWord(text, answer);
}

/**
 * One game room. Holds all short-lived game state in memory and enforces every
 * rule on the server: who may draw, what counts as a correct guess, scores,
 * timers, votes and teams.
 */
export class Room {
  readonly createdAt = Date.now();
  phase: GamePhase = 'lobby';
  hostId: string | null = null;

  private readonly players = new Map<string, ServerPlayer>();
  /** Banned player ids -> ban end time (Infinity = until the room closes). */
  private readonly banned = new Map<string, number>();
  /** Hashed IPs of banned players, so a new guest account on the same connection is refused too. */
  private readonly bannedIpKeys = new Map<string, number>();
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
  private artists: string[] = [];
  private penIndex = 0;
  private penEndsAt: number | null = null;
  private penTimer: NodeJS.Timeout | null = null;
  /** Strokes/fills started by the current pen holder (one-stroke challenge). */
  private penStrokes = 0;
  private choices: WordEntry[] = [];
  private word: WordEntry | null = null;
  private readonly revealed = new Set<number>();
  private turnStartedAt = 0;
  private turnDurationMs = 0;
  private phaseEndsAt: number | null = null;
  private correctCount = 0;
  private readonly turnDeltas = new Map<string, number>();
  private readonly reactionCounts = new Map<string, number>();
  private chaos: ChaosTurn | null = null;
  private readonly chaosCredited = new Set<string>();
  private lastTurn: TurnSummary | null = null;
  private turns: TurnRecord[] = [];

  // Teams: bonus points earned by each team this game / this turn.
  private readonly teamBonusPool = new Map<number, number>();
  private readonly turnTeamBonuses = new Map<number, number>();

  // Voting
  private roundCandidates: VoteCandidate[] = [];
  private voting: VotingState | null = null;

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
   * When late joining is allowed, newcomers guess straight away and draw from the next round.
   */
  assertCanJoin(playerId: string, ipKey: string | null = null): void {
    if (this.disposed) throw new GameError('not-found', 'This room has closed.');
    if (this.players.has(playerId)) return;
    const until = Math.max(this.banned.get(playerId) ?? 0, ipKey !== null ? (this.bannedIpKeys.get(ipKey) ?? 0) : 0);
    if (until > Date.now()) {
      const minutes = Math.ceil((until - Date.now()) / 60_000);
      throw new GameError(
        'banned',
        until === Infinity ? 'You cannot join this room.' : `You are banned from this room for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
      );
    }
    if (!this.settings.lateJoin && PLAYING_PHASES.includes(this.phase)) {
      throw new GameError('game-in-progress', 'This room does not allow joining a game in progress.');
    }
    if (this.players.size >= this.settings.maxPlayers) throw new GameError('room-full', 'This room is full.');
  }

  /** Whether a player could join right now (used by matchmaking). */
  canAccept(playerId: string, ipKey: string | null = null): boolean {
    try {
      this.assertCanJoin(playerId, ipKey);
      return true;
    } catch {
      return false;
    }
  }

  /** Adds a player, or reconnects them if they are already a member. */
  join(playerId: string, nickname: string, look?: PlayerLook, ipKey: string | null = null): 'joined' | 'rejoined' {
    this.assertCanJoin(playerId, ipKey);
    if (this.players.has(playerId)) {
      if (look) this.setLook(playerId, look);
      this.reconnect(playerId);
      return 'rejoined';
    }

    const player: ServerPlayer = {
      id: playerId,
      nickname: this.uniqueNickname(nickname),
      avatar: look?.avatar ?? defaultAvatar(playerId),
      title: look?.title ?? null,
      score: 0,
      connected: true,
      removeTimer: null,
      hasGuessed: false,
      muted: false,
      team: null,
      lastMessage: null,
      stats: emptyStats(),
      ipKey,
    };
    if (this.settings.teams) player.team = this.smallestTeam();
    this.players.set(playerId, player);
    // Private rooms: first player is admin. Public rooms: only the player who created the room
    // (Quick Play rooms have no admin and use vote-kick instead).
    if (!this.hostId && (this.visibility === 'private' || playerId === this.creatorId)) this.hostId = playerId;
    const teamNote = player.team !== null ? ` (${TEAMS[player.team]!.name})` : '';
    this.system(`${player.nickname} joined the room${teamNote}.`);
    this.updateAutoStart();
    this.touch();
    return 'joined';
  }

  /** Updates a player's avatar/title (already validated by the ProfileService). */
  setLook(playerId: string, look: PlayerLook): void {
    const p = this.players.get(playerId);
    if (!p || (p.avatar === look.avatar && p.title === look.title)) return;
    p.avatar = look.avatar;
    p.title = look.title;
    this.touch();
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
    if (this.phase === 'choosing' && playerId === this.drawerId) {
      out.toPlayers([playerId], 'turn:choices', { choices: this.choices.map(toChoice), remainingMs: this.remainingMs() ?? 0 });
    } else if (this.phase === 'drawing' && this.word && this.artists.includes(playerId)) {
      out.toPlayers([playerId], 'turn:word', { word: this.word.text });
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
    if (this.phase === 'drawing') {
      // A collaborative drawing doesn't wait for a disconnected artist.
      if (playerId === this.currentArtistId && this.artists.length > 1) this.passPen(null);
      this.checkAllGuessed();
    }
    if (this.phase === 'voting') this.closeVotingIfComplete();
    this.touch();
  }

  removePlayer(playerId: string, reason: RemoveReason, message?: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.removeTimer) clearTimeout(p.removeTimer);
    const wasCurrentArtist = playerId === this.currentArtistId;
    const artistIndex = this.artists.indexOf(playerId);
    this.players.delete(playerId);
    this.voteKicks.delete(playerId);
    for (const votes of this.voteKicks.values()) votes.delete(playerId);
    this.queue = this.queue.filter((id) => id !== playerId);

    const kickReason =
      reason === 'kicked'
        ? 'You were removed from the room by the room admin.'
        : reason === 'banned'
          ? 'You were banned from this room by the room admin.'
          : reason === 'vote-kicked'
            ? 'You were removed from the room by a player vote.'
            : reason === 'auto-banned'
              ? 'You have been banned from DrawWithSmile because many players reported you.'
              : null;
    this.deps.output.playerRemoved(playerId, message ?? kickReason);

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

    if (this.phase === 'lobby' && this.settings.teams && this.settings.teamAssignment === 'auto') this.fixTeamBalance();

    if (PLAYING_PHASES.includes(this.phase)) {
      if (this.players.size < LIMITS.MIN_PLAYERS_TO_START) {
        this.system('Not enough players left — the game is over.');
        this.endGame();
      } else if (this.phase === 'choosing' && this.drawerId === playerId) {
        this.endTurn('drawer-left');
      } else if (this.phase === 'drawing' && artistIndex >= 0) {
        this.artists.splice(artistIndex, 1);
        if (this.artists.length === 0) {
          this.endTurn('drawer-left');
        } else if (wasCurrentArtist) {
          // Hand the pen to whoever was next in line.
          this.penIndex = (artistIndex - 1 + this.artists.length) % this.artists.length;
          this.passPen(null);
        } else if (artistIndex < this.penIndex) {
          this.penIndex--;
        }
        if (this.phase === 'drawing') this.checkAllGuessed();
      } else if (this.phase === 'drawing') {
        this.checkAllGuessed();
      } else if (this.phase === 'voting') {
        this.closeVotingIfComplete();
      }
    }
    this.updateAutoStart();
    this.touch();
  }

  // ---------------------------------------------------------------- settings & lifecycle

  /** Host-only, lobby-only. Ranges are validated by the socket schema; combinations here. */
  updateSettings(byId: string, patch: Partial<RoomSettings>): void {
    this.assertHost(byId);
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'Room rules are locked while a game is running.');
    const next: RoomSettings = { ...this.settings, ...patch };
    const problem = validateSettings(next, this.players.size);
    if (problem) throw new GameError('bad-request', problem);

    const teamsChanged = next.teams !== this.settings.teams || next.teamCount !== this.settings.teamCount;
    const switchedToAuto = next.teamAssignment === 'auto' && this.settings.teamAssignment !== 'auto';
    this.settings = next;
    if (!next.teams) {
      for (const p of this.players.values()) p.team = null;
    } else if (teamsChanged || switchedToAuto) {
      this.rebalanceTeams();
    }
    this.touch();
  }

  /** Starts a game. `byId` is null when a public room starts automatically. */
  startGame(byId: string | null): void {
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'The game has already started.');
    if (byId !== null) this.assertHost(byId);
    if (this.connectedCount < LIMITS.MIN_PLAYERS_TO_START) {
      throw new GameError('not-enough-players', `At least ${LIMITS.MIN_PLAYERS_TO_START} players are needed to start.`);
    }
    const problem = validateSettings(this.settings, this.players.size);
    if (problem) throw new GameError('bad-request', problem);
    if (this.settings.teams) {
      if (this.connectedCount < this.settings.teamCount) {
        throw new GameError('not-enough-players', `Team Battle with ${this.settings.teamCount} teams needs at least ${this.settings.teamCount} players.`);
      }
      if (this.settings.teamAssignment === 'auto') this.rebalanceTeams();
      for (const p of this.players.values()) if (p.team === null) p.team = this.smallestTeam();
      for (let t = 0; t < this.settings.teamCount; t++) {
        if (![...this.players.values()].some((p) => p.team === t && p.connected)) {
          throw new GameError('bad-request', `${TEAMS[t]!.name} has no players. Balance the teams before starting.`);
        }
      }
    }
    this.cancelAutoStart();
    this.sessionId = randomUUID();
    this.gameStartedAt = new Date();
    this.turns = [];
    this.round = 0;
    this.turnNumber = 0;
    this.queue = [];
    this.lastTurn = null;
    this.roundCandidates = [];
    this.voting = null;
    this.teamBonusPool.clear();
    this.voteKicks.clear();
    for (const p of this.players.values()) {
      p.score = 0;
      p.stats = emptyStats();
    }
    this.system(this.rulesSummary());
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
    this.voting = null;
    this.roundCandidates = [];
    this.teamBonusPool.clear();
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

  // ---------------------------------------------------------------- teams

  /** Manual team selection in the lobby. */
  joinTeam(playerId: string, team: number): void {
    const p = this.requirePlayer(playerId);
    if (!this.settings.teams) throw new GameError('bad-request', 'Team Battle is not turned on in this room.');
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'Teams can only be changed in the lobby.');
    if (this.settings.teamAssignment !== 'manual') {
      throw new GameError('bad-request', 'Teams are assigned automatically in this room.');
    }
    if (!Number.isInteger(team) || team < 0 || team >= this.settings.teamCount) throw new GameError('bad-request', 'That team does not exist.');
    if (p.team === team) return;
    if (this.teamMembers(team).length >= this.teamCapacity()) throw new GameError('bad-request', 'That team is full.');
    p.team = team;
    this.system(`${p.nickname} joined ${TEAMS[team]!.name}.`);
    this.touch();
  }

  /** Host: spread players evenly across teams. */
  balanceTeams(byId: string): void {
    this.assertHost(byId);
    if (!this.settings.teams) throw new GameError('bad-request', 'Team Battle is not turned on in this room.');
    if (this.phase !== 'lobby') throw new GameError('wrong-phase', 'Teams can only be changed in the lobby.');
    this.rebalanceTeams();
    this.system('The host balanced the teams.');
    this.touch();
  }

  private teamCapacity(): number {
    return Math.ceil(this.settings.maxPlayers / this.settings.teamCount);
  }

  private teamMembers(team: number): ServerPlayer[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }

  private smallestTeam(): number {
    let best = 0;
    for (let t = 1; t < this.settings.teamCount; t++) {
      if (this.teamMembers(t).length < this.teamMembers(best).length) best = t;
    }
    return best;
  }

  /** Round-robin by join order, connected players first so every team gets active members. */
  private rebalanceTeams(): void {
    const ordered = [...this.players.values()].sort((a, b) => Number(b.connected) - Number(a.connected));
    ordered.forEach((p, i) => (p.team = i % this.settings.teamCount));
  }

  /** After someone leaves the lobby, move one player if teams differ by more than one. */
  private fixTeamBalance(): void {
    for (let guard = 0; guard < LIMITS.MAX_PLAYERS; guard++) {
      const sizes = Array.from({ length: this.settings.teamCount }, (_, t) => this.teamMembers(t).length);
      const max = Math.max(...sizes);
      const min = Math.min(...sizes);
      if (max - min <= 1) return;
      const mover = this.teamMembers(sizes.indexOf(max)).at(-1)!;
      mover.team = sizes.indexOf(min);
      this.system(`${mover.nickname} moved to ${TEAMS[mover.team]!.name} to keep teams even.`);
    }
  }

  private teamsPublic(): TeamPublic[] | null {
    if (!this.settings.teams) return null;
    return Array.from({ length: this.settings.teamCount }, (_, index) => {
      const members = this.teamMembers(index);
      const sum = members.reduce((total, p) => total + p.score, 0);
      const base = this.settings.teamScoring === 'average' ? Math.round(sum / Math.max(1, members.length)) : sum;
      const bonus = this.teamBonusPool.get(index) ?? 0;
      return { index, name: TEAMS[index]!.name, color: TEAMS[index]!.color, memberIds: members.map((p) => p.id), score: base + bonus, bonus };
    });
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
      const answers = this.answers();
      if (this.artists.includes(playerId) || p.hasGuessed) {
        if (answers.some((a) => mentionsAnswer(text, a))) {
          this.privateMessage(playerId, 'warning', 'Your message was hidden because it contains the word.');
          return;
        }
        const audience = [...this.players.values()].filter((x) => this.artists.includes(x.id) || x.hasGuessed).map((x) => x.id);
        this.deps.output.toPlayers(audience, 'chat:message', this.message('guessed-chat', censor(text), p));
        return;
      }
      if (isCorrectGuess(text, answers)) {
        this.correctGuess(p);
        return;
      }
      if (answers.some((a) => mentionsAnswer(text, a))) {
        // Shown only to the sender so the answer never leaks to other guessers.
        this.deps.output.toPlayers([playerId], 'chat:message', this.message('chat', text, p));
        return;
      }
      this.broadcast(this.message('chat', censor(text), p));
      if (answers.some((a) => isCloseGuess(text, a))) this.privateMessage(playerId, 'close', `"${text}" is very close!`);
      return;
    }
    if (this.phase === 'choosing' && playerId === this.drawerId && this.choices.some((w) => containsWord(text, w.text))) {
      this.privateMessage(playerId, 'warning', 'Your message was hidden because it contains one of your words.');
      return;
    }
    this.broadcast(this.message('chat', censor(text), p));
  }

  private answers(): string[] {
    return this.word ? [this.word.text, ...this.word.accepted] : [];
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
    p.stats.correctGuesses++;
    if (Date.now() - this.turnStartedAt <= TIMINGS.QUICK_GUESS_MS) p.stats.quickGuesses++;
    this.award(p, points);
    for (const id of this.artists) {
      const artist = this.players.get(id);
      if (artist) this.award(artist, drawerPointsPerGuess(word.difficulty));
    }
    if (this.chaos) {
      // Surviving chaos: guessing it, or drawing something that got guessed.
      for (const id of [p.id, ...this.artists]) {
        if (this.chaosCredited.has(id)) continue;
        const player = this.players.get(id);
        if (player) player.stats.chaosTurns++;
        this.chaosCredited.add(id);
      }
    }
    this.correctCount++;

    this.broadcast(this.message('correct', `${p.nickname} guessed the word!`));
    this.privateMessage(p.id, 'system', `You guessed it: "${word.text}" (+${points})`);
    this.checkTeamBonus(p.team);
    this.touch();
    this.checkAllGuessed();
  }

  /** Team bonus: every connected guesser of a team got the word this turn. */
  private checkTeamBonus(team: number | null): void {
    if (!this.settings.teams || team === null || this.settings.teamBonus <= 0 || this.turnTeamBonuses.has(team)) return;
    const guessers = this.teamMembers(team).filter((m) => m.connected && !this.artists.includes(m.id));
    if (guessers.length === 0 || !guessers.every((m) => m.hasGuessed)) return;
    const bonus = this.settings.teamBonus;
    this.turnTeamBonuses.set(team, bonus);
    this.teamBonusPool.set(team, (this.teamBonusPool.get(team) ?? 0) + bonus);
    this.system(`🎉 Everyone in ${TEAMS[team]!.name} got it! +${bonus} team bonus.`);
  }

  private checkAllGuessed(): void {
    if (this.phase !== 'drawing' || !this.word) return;
    const guessers = [...this.players.values()].filter((p) => p.connected && !this.artists.includes(p.id));
    if (guessers.length === 0 || !guessers.every((p) => p.hasGuessed)) return;
    if (this.correctCount > 0) {
      for (const id of this.artists) {
        const artist = this.players.get(id);
        if (!artist) continue;
        this.award(artist, drawerAllGuessedBonus(this.word.difficulty));
        artist.stats.perfectDrawings++;
      }
    }
    this.endTurn('all-guessed');
  }

  // ---------------------------------------------------------------- reactions & voting

  react(playerId: string, emoji: ReactionEmoji): void {
    this.requirePlayer(playerId);
    if (!this.settings.reactions) throw new GameError('bad-request', 'Reactions are turned off in this room.');
    if (this.phase !== 'drawing' && this.phase !== 'turnEnd') throw new GameError('wrong-phase', 'Reactions work while someone is drawing.');
    if (!(REACTIONS as readonly string[]).includes(emoji)) throw new GameError('bad-request', 'Unknown reaction.');
    this.reactionCounts.set(emoji, (this.reactionCounts.get(emoji) ?? 0) + 1);
    this.deps.output.toAll('reaction', { playerId, emoji });
  }

  castVote(voterId: string, category: VoteCategory, turnNumber: number): void {
    this.requirePlayer(voterId);
    const voting = this.voting;
    if (this.phase !== 'voting' || !voting || voting.closed) throw new GameError('wrong-phase', 'Voting has closed.');
    if (!voting.categories.includes(category)) throw new GameError('bad-request', 'That vote category is not used in this room.');
    const candidate = voting.candidates.find((c) => c.turnNumber === turnNumber);
    if (!candidate) throw new GameError('bad-request', 'That drawing is not part of this vote.');
    if (candidate.artistIds.includes(voterId)) throw new GameError('bad-request', "You can't vote for your own drawing.");
    const mine = voting.votes.get(voterId) ?? new Map<VoteCategory, number>();
    if (mine.has(category)) throw new GameError('bad-request', 'You already voted in this category.');
    mine.set(category, turnNumber);
    voting.votes.set(voterId, mine);
    this.closeVotingIfComplete();
    this.touch();
  }

  private shouldVote(): boolean {
    return this.settings.voting && this.roundCandidates.length > 0 && this.connectedCount >= LIMITS.MIN_PLAYERS_TO_START;
  }

  private startVoting(): void {
    const categories: VoteCategory[] = ['funniest', 'creative'];
    if (this.settings.collaborative || this.settings.teams) categories.push('teamwork');
    this.voting = { candidates: [...this.roundCandidates], categories, votes: new Map(), closed: false, winners: null };
    this.phase = 'voting';
    const ms = this.settings.votingSeconds * 1000;
    this.phaseEndsAt = Date.now() + ms;
    this.schedule(ms, () => this.closeVoting());
    this.system('🗳️ Vote for the best drawings of this round!');
    this.touch();
  }

  /** Closes early once every connected player has voted everywhere they are allowed to. */
  private closeVotingIfComplete(): void {
    const voting = this.voting;
    if (this.phase !== 'voting' || !voting || voting.closed) return;
    const done = [...this.players.values()]
      .filter((p) => p.connected)
      .every((p) => {
        const eligible = voting.candidates.some((c) => !c.artistIds.includes(p.id));
        return !eligible || voting.categories.every((cat) => voting.votes.get(p.id)?.has(cat));
      });
    if (done) this.closeVoting();
  }

  private closeVoting(): void {
    const voting = this.voting;
    if (!voting || voting.closed) return;
    this.clearPhaseTimers();
    voting.closed = true;
    voting.winners = [];

    // Every vote counts towards the artists' "votes received" statistic.
    for (const ballot of voting.votes.values()) {
      for (const turnNumber of ballot.values()) {
        const candidate = voting.candidates.find((c) => c.turnNumber === turnNumber);
        for (const id of candidate?.artistIds ?? []) {
          const artist = this.players.get(id);
          if (artist) artist.stats.votesReceived++;
        }
      }
    }

    for (const category of voting.categories) {
      const tally = new Map<number, number>();
      for (const ballot of voting.votes.values()) {
        const turn = ballot.get(category);
        if (turn !== undefined) tally.set(turn, (tally.get(turn) ?? 0) + 1);
      }
      const max = Math.max(0, ...tally.values());
      const info = VOTE_CATEGORIES.find((c) => c.id === category)!;
      if (max === 0) {
        this.system(`${info.icon} ${info.name}: no votes.`);
        continue;
      }
      for (const candidate of voting.candidates.filter((c) => tally.get(c.turnNumber) === max)) {
        voting.winners.push({ category, turnNumber: candidate.turnNumber, artistIds: candidate.artistIds, votes: max });
        if (this.settings.voteBonus > 0) {
          for (const id of candidate.artistIds) {
            const artist = this.players.get(id);
            if (artist) this.award(artist, this.settings.voteBonus);
          }
        }
        const names = candidate.artistIds.map((id) => this.players.get(id)?.nickname ?? 'someone').join(' & ');
        const bonus = this.settings.voteBonus > 0 ? ` +${this.settings.voteBonus}` : '';
        this.system(`${info.icon} ${info.name}: "${candidate.word}" by ${names} (${max} vote${max === 1 ? '' : 's'})${bonus}`);
      }
    }

    this.phaseEndsAt = Date.now() + TIMINGS.VOTE_REVEAL_MS;
    this.schedule(TIMINGS.VOTE_REVEAL_MS, () => this.nextTurn(true));
    this.touch();
  }

  // ---------------------------------------------------------------- drawing

  get currentArtistId(): string | null {
    return this.phase === 'drawing' ? (this.artists[this.penIndex] ?? null) : null;
  }

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
      this.assertChaosColour(chunk.tool === 'pen' ? chunk.color : null);
      if (this.hasChaos('one-stroke') && this.penStrokes >= 1) throw new GameError('bad-request', 'One stroke only! Your line is finished.');
      stroke = { kind: 'stroke', id: chunk.id, tool: chunk.tool, color: chunk.color, size: chunk.size, points: [] };
      this.ops.push(stroke);
      this.usedOpIds.add(chunk.id);
      this.redoStack = [];
      this.openStroke = stroke;
      this.penStrokes++;
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
    this.assertEditable();
    this.openStroke = null;
    const op = this.ops.pop();
    if (!op) return;
    this.redoStack.push(op);
    this.deps.output.toAll('draw:undo', { opId: op.id });
  }

  redo(playerId: string): void {
    this.assertDrawing(playerId);
    this.assertEditable();
    this.openStroke = null;
    const op = this.redoStack.pop();
    if (!op) return;
    this.ops.push(op);
    this.deps.output.toAll('draw:redo', op);
  }

  clear(playerId: string): void {
    this.assertDrawing(playerId);
    this.assertEditable();
    this.openStroke = null;
    if (this.ops.length === 0 || this.ops[this.ops.length - 1]!.kind === 'clear') return;
    if (this.ops.length >= LIMITS.MAX_OPS_PER_TURN) this.ops = [];
    const op: ClearOp = { kind: 'clear', id: shortId() };
    this.ops.push(op);
    this.usedOpIds.add(op.id);
    this.redoStack = [];
    this.deps.output.toAll('draw:clear', op);
  }

  /** Paint-bucket fill. Only the point and colour travel; every client fills locally. */
  fill(playerId: string, fill: Omit<FillOp, 'kind'>): void {
    this.assertDrawing(playerId);
    if (this.hasChaos('one-stroke')) throw new GameError('bad-request', 'Fill is not allowed in the one-stroke challenge.');
    this.assertChaosColour(fill.color);
    this.openStroke = null;
    if (this.usedOpIds.has(fill.id)) throw new GameError('bad-request', 'Duplicate fill.');
    if (this.ops.length >= LIMITS.MAX_OPS_PER_TURN) {
      throw new GameError('bad-request', 'The canvas is full. Clear it or undo to keep drawing.');
    }
    if (this.ops.filter((op) => op.kind === 'fill').length >= LIMITS.MAX_FILLS_PER_TURN) {
      throw new GameError('bad-request', 'You have used a lot of fills this turn. Undo or clear to fill again.');
    }
    const op: FillOp = { kind: 'fill', id: fill.id, color: fill.color, x: fill.x, y: fill.y };
    this.ops.push(op);
    this.usedOpIds.add(op.id);
    this.redoStack = [];
    this.deps.output.toAll('draw:fill', op, playerId);
  }

  /** Collaborative mode: pass the pen early (or automatically when `byId` is null). */
  passPen(byId: string | null): void {
    if (this.phase !== 'drawing') {
      if (byId !== null) throw new GameError('wrong-phase', 'Nobody is drawing right now.');
      return;
    }
    if (byId !== null) {
      this.assertDrawing(byId);
      if (this.artists.length < 2) throw new GameError('bad-request', 'There is nobody to pass the pen to.');
    }
    const count = this.artists.length;
    let nextIndex = -1;
    for (let step = 1; step <= count; step++) {
      // step === count wraps back to the current artist (kept if nobody else is connected).
      const candidate = (this.penIndex + step) % count;
      if (this.players.get(this.artists[candidate]!)?.connected) {
        nextIndex = candidate;
        break;
      }
    }
    if (nextIndex < 0) {
      // No connected artist left: the drawing can't continue.
      this.endTurn('drawer-left');
      return;
    }
    const changed = nextIndex !== this.penIndex;
    this.penIndex = nextIndex;
    this.startPen();
    if (changed) this.system(`✏️ ${this.players.get(this.artists[nextIndex]!)!.nickname} has the pen.`);
    this.touch();
  }

  private startPen(): void {
    this.penStrokes = 0;
    this.openStroke = null;
    if (this.penTimer) clearTimeout(this.penTimer);
    this.penTimer = null;
    this.penEndsAt = null;
    if (this.artists.length < 2 || this.phaseEndsAt === null) return;
    const ms = Math.min(this.settings.artistSeconds * 1000, Math.max(0, this.phaseEndsAt - Date.now()));
    this.penEndsAt = Date.now() + ms;
    this.penTimer = setTimeout(() => {
      this.penTimer = null;
      if (!this.disposed) this.passPen(null);
    }, ms);
  }

  private stopPen(): void {
    if (this.penTimer) clearTimeout(this.penTimer);
    this.penTimer = null;
    this.penEndsAt = null;
  }

  drawHistory(): DrawOp[] {
    return this.ops.map((op): DrawOp => (op.kind === 'stroke' ? { ...op, points: [...op.points] } : { ...op }));
  }

  /** True for the player currently allowed to draw. */
  isDrawer(playerId: string): boolean {
    return this.currentArtistId === playerId;
  }

  private hasChaos(rule: ChaosRule): boolean {
    return this.chaos?.rules.includes(rule) ?? false;
  }

  private assertChaosColour(color: string | null): void {
    if (color !== null && this.chaos?.palette && !this.chaos.palette.includes(color)) {
      throw new GameError('bad-request', "That colour isn't in this turn's palette.");
    }
  }

  private assertEditable(): void {
    if (this.hasChaos('one-stroke')) throw new GameError('bad-request', 'No undo, redo or clear in the one-stroke challenge.');
  }

  private rollChaos(): ChaosTurn {
    const enabled = CHAOS_RULE_IDS.filter((r) => this.settings.chaosRules.includes(r));
    const picked = this.settings.chaosRandom ? shuffle([...enabled]).slice(0, 1 + randomInt(Math.min(3, enabled.length))) : enabled;
    const rules = CHAOS_RULE_IDS.filter((r) => picked.includes(r));
    return {
      rules,
      palette: rules.includes('limited-palette')
        ? shuffle(PALETTE.filter((c) => c !== '#ffffff')).slice(0, LIMITED_PALETTE_SIZE)
        : null,
      flip: rules.includes('flipped-canvas') ? (randomInt(2) === 0 ? 'horizontal' : 'vertical') : null,
      brushSeed: rules.includes('shifting-brush') ? randomInt(1_000_000) : null,
    };
  }

  // ---------------------------------------------------------------- moderation

  /**
   * Room admin removes anyone, at any time. `banMinutes`: false = kick (may rejoin straight away),
   * a number = temporary ban from THIS room only (other rooms are unaffected). The ban also
   * blocks a new guest account from the same connection until it ends.
   */
  kick(byId: string, targetId: string, banMinutes: false | number): void {
    this.assertHost(byId);
    if (byId === targetId) throw new GameError('bad-request', 'You cannot remove yourself.');
    const target = this.requirePlayer(targetId);
    let message: string | undefined;
    if (banMinutes !== false) {
      if (!Number.isFinite(banMinutes) || banMinutes <= 0) throw new GameError('bad-request', 'Bans must have a time limit.');
      const until = Date.now() + banMinutes * 60_000;
      this.banned.set(targetId, until);
      if (target.ipKey) this.bannedIpKeys.set(target.ipKey, until);
      message = `The room admin banned you from this room for ${banMinutes} minutes. You can still play in other rooms.`;
    }
    this.deps.hooks?.onModeration?.({ roomCode: this.code, actorId: byId, targetId, action: banMinutes === false ? 'kick' : 'ban' });
    this.removePlayer(targetId, banMinutes === false ? 'kicked' : 'banned', message);
    if (banMinutes !== false && !this.disposed) this.system(`${target.nickname} was banned from this room for ${banMinutes} minutes.`);
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
      this.banned.set(targetId, Infinity);
      if (target.ipKey) this.bannedIpKeys.set(target.ipKey, Infinity);
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

  private nextTurn(afterVote = false): void {
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
      // A round just finished: vote on its drawings first (if enabled).
      if (!afterVote && this.round > 0 && this.shouldVote()) {
        this.startVoting();
        return;
      }
      this.voting = null;
      this.roundCandidates = [];
      this.round++;
      if (this.round > this.settings.rounds) {
        this.endGame();
        return;
      }
      this.queue = this.buildQueue();
      next = this.takeNextDrawer();
      if (!next) {
        this.endGame();
        return;
      }
      this.system(`Round ${this.round} of ${this.settings.rounds}`);
    }
    this.beginChoosing(next);
  }

  /** Join order; in Team Battle the teams take turns (A, B, A, B…). */
  private buildQueue(): string[] {
    const connected = [...this.players.values()].filter((p) => p.connected);
    if (!this.settings.teams) return connected.map((p) => p.id);
    const byTeam = Array.from({ length: this.settings.teamCount }, (_, t) => connected.filter((p) => p.team === t));
    const queue: string[] = [];
    for (let i = 0; byTeam.some((members) => i < members.length); i++) {
      for (const members of byTeam) if (members[i]) queue.push(members[i]!.id);
    }
    return queue;
  }

  private takeNextDrawer(): ServerPlayer | undefined {
    while (this.queue.length > 0) {
      const p = this.players.get(this.queue.shift()!);
      if (p?.connected) return p;
    }
    return undefined;
  }

  private beginChoosing(next: ServerPlayer): void {
    this.drawerId = next.id;
    this.artists = [next.id, ...this.coArtists(next.id)];
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
    this.schedule(TIMINGS.CHOOSE_WORD_MS, () => this.beginDrawing(randomInt(this.choices.length)));
    this.touch();
  }

  /** Collaborative mode: the next players in join order share the pen (at least one guesser always remains). */
  private coArtists(drawerId: string): string[] {
    if (!this.settings.collaborative) return [];
    const connected = [...this.players.values()].filter((p) => p.connected).map((p) => p.id);
    const start = connected.indexOf(drawerId);
    const rotated = [...connected.slice(start + 1), ...connected.slice(0, Math.max(0, start))];
    const room = Math.max(0, connected.length - 2);
    return rotated.slice(0, Math.min(this.settings.artistCount - 1, room));
  }

  private beginDrawing(index: number): void {
    const word = this.choices[index];
    if (this.phase !== 'choosing' || !word) return;
    this.clearPhaseTimers();
    this.word = word;
    this.choices = [];
    this.recentWords.push(normalizeGuess(word.text));
    if (this.recentWords.length > RECENT_WORDS_LIMIT) this.recentWords.shift();

    for (const id of this.artists) {
      const artist = this.players.get(id);
      if (!artist) continue;
      artist.stats.drawings++;
      if (this.artists.length > 1) artist.stats.collabDrawings++;
    }
    this.phase = 'drawing';
    this.turnStartedAt = Date.now();
    this.turnDurationMs = this.settings.drawTime * 1000;
    this.phaseEndsAt = this.turnStartedAt + this.turnDurationMs;
    this.chaos = this.settings.mode === 'chaos' ? this.rollChaos() : null;

    const hints = this.settings.hints ? hintCount(word.text) : 0;
    const order = shuffle(hintableIndexes(word.text));
    for (let k = 1; k <= hints; k++) {
      const letter = order[k - 1];
      if (letter === undefined) break;
      this.schedule(this.turnDurationMs * (0.4 + (0.45 * k) / (hints + 1)), () => {
        this.revealed.add(letter);
        this.touch();
      });
    }
    this.schedule(this.turnDurationMs, () => this.endTurn('time-up'));

    this.penIndex = 0;
    this.startPen();
    this.deps.output.toPlayers(this.artists, 'turn:word', { word: word.text });
    const names = this.artists.map((id) => this.players.get(id)?.nickname ?? 'someone');
    this.system(
      names.length > 1 ? `${names.join(' & ')} are drawing together! ${names[0]} has the pen first.` : `${names[0]} is drawing now!`,
    );
    if (this.chaos) {
      const labels = this.chaos.rules.map((r) => CHAOS_RULES.find((c) => c.id === r)!).map((c) => `${c.icon} ${c.name}`);
      this.system(`🌪️ Chaos challenges: ${labels.join(', ')}`);
    }
    this.touch();
  }

  private endTurn(reason: TurnEndReason): void {
    if (this.phase !== 'choosing' && this.phase !== 'drawing') return;
    this.clearPhaseTimers();
    this.stopPen();
    const word = this.word;
    if (word && this.drawerId) {
      this.turns.push({
        round: this.round,
        turnNumber: this.turnNumber,
        drawerId: this.drawerId,
        artistIds: [...this.artists],
        wordId: word.id,
        wordText: word.text,
        correctGuesses: this.correctCount,
        endReason: reason,
        startedAt: new Date(this.turnStartedAt),
        endedAt: new Date(),
      });
      if (this.artists.length > 0) {
        this.roundCandidates.push({ turnNumber: this.turnNumber, artistIds: [...this.artists], word: word.text });
      }
      this.system(`The word was "${word.text}".`);
    } else {
      this.system('The drawer left, so this turn was skipped.');
    }
    this.lastTurn = {
      turnNumber: this.turnNumber,
      word: word?.text ?? '',
      drawerId: this.drawerId ?? '',
      artistIds: [...this.artists],
      deltas: Object.fromEntries(this.turnDeltas),
      teamBonuses: Object.fromEntries(this.turnTeamBonuses),
      reactions: Object.fromEntries(this.reactionCounts),
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
    this.voting = null;
    this.phase = 'gameEnd';
    this.phaseEndsAt = Date.now() + TIMINGS.GAME_END_RETURN_MS;

    const standings = this.standings();
    const teams = this.teamsPublic();
    const bestTeamScore = teams ? Math.max(...teams.map((t) => t.score)) : 0;
    const winningTeams = new Set(teams?.filter((t) => t.score === bestTeamScore && t.score > 0).map((t) => t.index) ?? []);
    if (teams && winningTeams.size > 0) {
      const names = [...winningTeams].map((i) => TEAMS[i]!.name).join(' & ');
      this.system(`🏆 ${names} ${winningTeams.size > 1 ? 'tie' : 'wins'} the Team Battle with ${bestTeamScore} points!`);
    }
    const winner = standings[0];
    if (winner && winner.score > 0) this.system(`🏆 ${winner.nickname} has the top score: ${winner.score} points!`);

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
        rules: { ...this.settings, categories: [...this.settings.categories], chaosRules: [...this.settings.chaosRules] },
        turns: [...this.turns],
        players: standings.map((s) => {
          const p = this.players.get(s.playerId)!;
          return {
            playerId: s.playerId,
            nickname: s.nickname,
            finalScore: s.score,
            rank: s.rank,
            isWinner: s.rank === 1 && s.score > 0,
            team: p.team,
            teamWin: p.team !== null && winningTeams.has(p.team),
            ...p.stats,
          };
        }),
      });
    }
    this.sessionId = null;
    this.schedule(TIMINGS.GAME_END_RETURN_MS, () => this.backToLobby(null));
    this.touch();
  }

  private resetTurn(): void {
    this.stopPen();
    this.drawerId = null;
    this.artists = [];
    this.penIndex = 0;
    this.penStrokes = 0;
    this.word = null;
    this.choices = [];
    this.revealed.clear();
    this.correctCount = 0;
    this.turnDeltas.clear();
    this.turnTeamBonuses.clear();
    this.reactionCounts.clear();
    this.chaos = null;
    this.chaosCredited.clear();
    this.ops = [];
    this.redoStack = [];
    this.usedOpIds.clear();
    this.openStroke = null;
    this.totalPoints = 0;
    for (const p of this.players.values()) p.hasGuessed = false;
    this.deps.output.toAll('draw:history', []);
  }

  private rulesSummary(): string {
    const s = this.settings;
    const parts = [`${s.rounds} round${s.rounds === 1 ? '' : 's'}`, `${s.drawTime}s to draw`];
    if (s.language === 'mixed') parts.push('English + Tamil words');
    if (s.mode === 'chaos') parts.push('🌪️ Chaos mode');
    if (s.collaborative) parts.push(`🤝 ${s.artistCount} artists per drawing`);
    if (s.teams) parts.push(`⚔️ ${s.teamCount} teams`);
    if (s.voting) parts.push('🗳️ voting');
    if (!s.hints) parts.push('no hints');
    return `Rules: ${parts.join(' · ')}`;
  }

  // ---------------------------------------------------------------- public lobbies

  private updateAutoStart(): void {
    if (this.visibility !== 'public' || this.phase !== 'lobby' || this.disposed) {
      this.cancelAutoStart();
      return;
    }
    const connected = this.connectedCount;
    if (connected < LIMITS.MIN_PLAYERS_TO_START || (this.settings.teams && connected < this.settings.teamCount)) {
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
      if (this.phase !== 'lobby' || this.connectedCount < LIMITS.MIN_PLAYERS_TO_START) return this.touch();
      try {
        this.startGame(null);
      } catch {
        this.touch();
      }
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
    const currentArtist = this.currentArtistId;
    const players: PlayerPublic[] = [...this.players.values()].map((p) => ({
      id: p.id,
      nickname: p.nickname,
      avatar: p.avatar,
      title: p.title,
      score: p.score,
      isHost: p.id === this.hostId,
      connected: p.connected,
      hasGuessed: p.hasGuessed,
      isDrawer: this.phase === 'choosing' ? p.id === this.drawerId : p.id === currentArtist,
      isArtist: this.artists.includes(p.id),
      muted: p.muted,
      team: p.team,
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
      settings: { ...this.settings, categories: [...this.settings.categories], chaosRules: [...this.settings.chaosRules] },
      players,
      hostId: this.hostId,
      round: this.round,
      totalRounds: this.settings.rounds,
      drawerId: this.drawerId,
      artistIds: [...this.artists],
      currentArtistId: currentArtist,
      artistRemainingMs: this.penEndsAt === null ? null : Math.max(0, this.penEndsAt - now),
      hint,
      wordLanguage: this.phase === 'drawing' ? (this.word?.language ?? null) : null,
      phaseRemainingMs: this.remainingMs(),
      autoStartInMs: this.autoStartAt === null ? null : Math.max(0, this.autoStartAt - now),
      chaos: this.phase === 'drawing' ? this.chaos : null,
      teams: this.teamsPublic(),
      voting: this.voting
        ? {
            candidates: this.voting.candidates,
            categories: this.voting.categories,
            voters: this.voting.votes.size,
            closed: this.voting.closed,
            winners: this.voting.winners,
          }
        : null,
      reactions: Object.fromEntries(this.reactionCounts),
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

  get currentArtists(): readonly string[] {
    return this.artists;
  }

  get currentChaos(): ChaosTurn | null {
    return this.chaos;
  }

  get currentRound(): number {
    return this.round;
  }

  private standings(): Standing[] {
    return rankByScore(
      [...this.players.values()].map((p) => ({ playerId: p.id, nickname: p.nickname, avatar: p.avatar, score: p.score, team: p.team })),
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
    if (this.hostId !== playerId) {
      throw new GameError('not-host', 'Only the room admin can do that.');
    }
  }

  private assertDrawing(playerId: string): void {
    if (this.phase !== 'drawing' || playerId !== this.currentArtistId) {
      throw new GameError('not-drawer', 'Only the artist holding the pen can draw.');
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
  return { text: word.text, difficulty: word.difficulty, category: word.category, language: word.language };
}
