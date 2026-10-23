export type Language = 'en' | 'ta';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultySetting = Difficulty | 'mixed';
export type RoomVisibility = 'public' | 'private';

/**
 * lobby    – waiting for players / host to start
 * choosing – drawer is picking one of three words
 * drawing  – drawer draws, others guess
 * turnEnd  – word revealed, scores for the turn shown
 * gameEnd  – final leaderboard
 */
export type GamePhase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'gameEnd';

export interface LanguageInfo {
  code: Language;
  label: string;
}

export interface CategoryInfo {
  slug: string;
  label: Record<Language, string>;
}

export interface RoomSettings {
  /** Seconds the drawer has to draw. */
  drawTime: number;
  /** Number of times every player gets to draw. */
  rounds: number;
  language: Language;
  difficulty: DifficultySetting;
  maxPlayers: number;
  /** Category slugs; empty means all categories. */
  categories: string[];
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  avatar: number;
  score: number;
  isHost: boolean;
  connected: boolean;
  hasGuessed: boolean;
  isDrawer: boolean;
  muted: boolean;
}

export interface TurnSummary {
  word: string;
  drawerId: string;
  /** Points gained during the turn, by player id. */
  deltas: Record<string, number>;
  reason: TurnEndReason;
}

export type TurnEndReason = 'time-up' | 'all-guessed' | 'drawer-left' | 'not-enough-players';

export interface Standing {
  playerId: string;
  nickname: string;
  avatar: number;
  score: number;
  rank: number;
}

export interface RoomState {
  code: string;
  /** Display name, e.g. "The Butterfly Room". */
  name: string;
  visibility: RoomVisibility;
  /** Private rooms only: shown in the private room list. */
  listed: boolean;
  phase: GamePhase;
  settings: RoomSettings;
  players: PlayerPublic[];
  hostId: string | null;
  round: number;
  totalRounds: number;
  drawerId: string | null;
  /**
   * Masked word, one entry per grapheme: null = hidden letter,
   * otherwise the revealed character (spaces/hyphens are always revealed).
   */
  hint: (string | null)[] | null;
  /** Milliseconds left in the current phase when this state was emitted. */
  phaseRemainingMs: number | null;
  /** Public lobbies: milliseconds until the game starts automatically. */
  autoStartInMs: number | null;
  lastTurn: TurnSummary | null;
  standings: Standing[] | null;
  /** Vote-kick tallies in public rooms (target id -> votes). */
  voteKicks: Record<string, number>;
  votesNeeded: number;
}

export type ChatKind =
  /** Normal message visible to everyone. */
  | 'chat'
  /** Message from the drawer / players who already guessed; only they can see it. */
  | 'guessed-chat'
  | 'system'
  | 'correct'
  /** Private hint that a guess was very close. */
  | 'close'
  | 'warning';

export interface ChatMessage {
  id: string;
  kind: ChatKind;
  playerId?: string;
  nickname?: string;
  text: string;
  ts: number;
}

export type Tool = 'pen' | 'eraser';

export interface StrokeOp {
  kind: 'stroke';
  id: string;
  tool: Tool;
  color: string;
  size: number;
  /** Flat [x0, y0, x1, y1, …] integers in 0..COORD_MAX. */
  points: number[];
}

export interface ClearOp {
  kind: 'clear';
  id: string;
}

export type DrawOp = StrokeOp | ClearOp;

/** A live piece of a stroke. The first chunk for an id starts the stroke. */
export interface StrokeChunk {
  id: string;
  tool: Tool;
  color: string;
  size: number;
  points: number[];
  final: boolean;
}

export interface WordChoice {
  text: string;
  difficulty: Difficulty;
  category: string;
}

/** One row of the room browser. */
export interface RoomListing {
  code: string;
  name: string;
  visibility: RoomVisibility;
  players: number;
  maxPlayers: number;
  language: Language;
  phase: GamePhase;
  round: number;
  totalRounds: number;
}

export interface RoomDirectory {
  publicRooms: RoomListing[];
  privateRooms: RoomListing[];
  totals: { publicRooms: number; publicPlayers: number; privateRooms: number; privatePlayers: number };
  online: number;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  totalScore: number;
  wins: number;
  gamesPlayed: number;
}

export interface Achievement {
  code: string;
  name: string;
  description: string;
  earnedAt: string | null;
}

export interface PlayerStats {
  playerId: string;
  gamesPlayed: number;
  wins: number;
  totalScore: number;
  bestScore: number;
  correctGuesses: number;
  drawings: number;
  achievements: Achievement[];
}

export interface SessionInfo {
  playerId: string;
  token: string;
}
