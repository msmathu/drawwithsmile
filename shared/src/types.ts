/** Languages that have word packs. Add a code here (and words in the seeds) to add a language. */
export type Language = 'en' | 'ta';
/** Word language setting for a room: one language, or a mix of all packs. */
export type WordLanguage = Language | 'mixed';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultySetting = Difficulty | 'mixed';
export type RoomVisibility = 'public' | 'private';

/**
 * lobby    – waiting for players / host to start
 * choosing – drawer is picking one of three words
 * drawing  – artists draw, others guess
 * turnEnd  – word revealed, scores for the turn shown
 * voting   – end of a round: players vote for the round's drawings (optional)
 * gameEnd  – final leaderboard
 */
export type GamePhase = 'lobby' | 'choosing' | 'drawing' | 'turnEnd' | 'voting' | 'gameEnd';

export interface LanguageInfo {
  code: WordLanguage;
  label: string;
}

export interface CategoryInfo {
  slug: string;
  label: Record<Language, string>;
}

export type GameMode = 'normal' | 'chaos';

/**
 * Chaos Drawing challenges.
 * - invisible-ink: the drawer can't see the line (or cursor) until the pen is lifted
 * - limited-palette: only a few random colours are allowed
 * - flipped-canvas: the drawer's input is mirrored horizontally or vertically
 * - shifting-brush: the brush size changes by itself every few seconds
 * - one-stroke: one continuous stroke per artist turn (no fill, undo or clear)
 */
export type ChaosRule = 'invisible-ink' | 'limited-palette' | 'flipped-canvas' | 'shifting-brush' | 'one-stroke';

export type TeamAssignment = 'auto' | 'manual';
/** Team score = sum of members' points, or their average (fair for uneven teams). */
export type TeamScoring = 'total' | 'average';
export type VoteCategory = 'funniest' | 'creative' | 'teamwork';

export interface RoomSettings {
  /** Seconds the drawer has to draw. */
  drawTime: number;
  /** Number of times every player gets to draw. */
  rounds: number;
  language: WordLanguage;
  difficulty: DifficultySetting;
  maxPlayers: number;
  /** Category slugs; empty means all categories. */
  categories: string[];
  /** Reveal letters of the word as time runs out. */
  hints: boolean;
  /** Allow new players to join a game in progress. */
  lateJoin: boolean;

  mode: GameMode;
  /** Chaos challenges the host enabled. */
  chaosRules: ChaosRule[];
  /** true: each turn uses a random combination of the enabled challenges; false: all of them every turn. */
  chaosRandom: boolean;

  /** One drawing, multiple artists. */
  collaborative: boolean;
  /** Artists sharing each drawing (they all know the word). */
  artistCount: number;
  /** Seconds each artist holds the pen before it passes on. */
  artistSeconds: number;

  /** Live emoji reactions while drawing. */
  reactions: boolean;
  /** Vote for the round's drawings at the end of every round. */
  voting: boolean;
  votingSeconds: number;
  /** Points for each artist of a drawing that wins a vote category (0 = none). */
  voteBonus: number;

  /** Team Battle. */
  teams: boolean;
  teamCount: number;
  teamAssignment: TeamAssignment;
  teamScoring: TeamScoring;
  /** Bonus for a team when all its guessers get the word in one turn (0 = none). */
  teamBonus: number;
}

export interface PlayerPublic {
  id: string;
  nickname: string;
  avatar: number;
  /** Selected title id (see TITLES), if any. */
  title: string | null;
  score: number;
  isHost: boolean;
  connected: boolean;
  hasGuessed: boolean;
  /** Currently holding the pen. */
  isDrawer: boolean;
  /** One of this turn's artists (knows the word). */
  isArtist: boolean;
  muted: boolean;
  /** Team index in Team Battle, otherwise null. */
  team: number | null;
}

export interface TurnSummary {
  turnNumber: number;
  word: string;
  /** Player who chose the word. */
  drawerId: string;
  /** Everyone who drew (more than one in collaborative mode). */
  artistIds: string[];
  /** Points gained during the turn, by player id. */
  deltas: Record<string, number>;
  /** Team bonus awarded this turn, by team index. */
  teamBonuses: Record<number, number>;
  reactions: Record<string, number>;
  reason: TurnEndReason;
}

export type TurnEndReason = 'time-up' | 'all-guessed' | 'drawer-left' | 'not-enough-players';

export interface Standing {
  playerId: string;
  nickname: string;
  avatar: number;
  score: number;
  rank: number;
  team: number | null;
}

/** Chaos challenges active for the current turn (public, so everyone can see them). */
export interface ChaosTurn {
  rules: ChaosRule[];
  /** limited-palette: the only colours allowed. */
  palette: string[] | null;
  /** flipped-canvas: which axis is mirrored. */
  flip: 'horizontal' | 'vertical' | null;
  /** shifting-brush: seed for the brush-size schedule. */
  brushSeed: number | null;
}

export interface TeamPublic {
  index: number;
  name: string;
  color: string;
  memberIds: string[];
  /** Team score after the scoring rule, including bonus. */
  score: number;
  bonus: number;
}

export interface VoteCandidate {
  turnNumber: number;
  artistIds: string[];
  word: string;
}

export interface VoteWinner {
  category: VoteCategory;
  turnNumber: number;
  artistIds: string[];
  votes: number;
}

export interface VotingPublic {
  candidates: VoteCandidate[];
  categories: VoteCategory[];
  /** Number of players who have voted (tallies stay secret until closed). */
  voters: number;
  closed: boolean;
  /** Filled in when voting closes. */
  winners: VoteWinner[] | null;
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
  /** Player who chose this turn's word. */
  drawerId: string | null;
  /** All artists of this turn, in pen order. */
  artistIds: string[];
  /** Player currently holding the pen. */
  currentArtistId: string | null;
  /** Collaborative mode: milliseconds until the pen passes on. */
  artistRemainingMs: number | null;
  /**
   * Masked word, one entry per grapheme: null = hidden letter,
   * otherwise the revealed character (spaces/hyphens are always revealed).
   */
  hint: (string | null)[] | null;
  /** Language of the current word (useful in mixed mode). */
  wordLanguage: Language | null;
  /** Milliseconds left in the current phase when this state was emitted. */
  phaseRemainingMs: number | null;
  /** Public lobbies: milliseconds until the game starts automatically. */
  autoStartInMs: number | null;
  chaos: ChaosTurn | null;
  teams: TeamPublic[] | null;
  voting: VotingPublic | null;
  /** Emoji reaction counts for the current turn. */
  reactions: Record<string, number>;
  lastTurn: TurnSummary | null;
  standings: Standing[] | null;
  /** Vote-kick tallies in public rooms (target id -> votes). */
  voteKicks: Record<string, number>;
  votesNeeded: number;
}

export type ChatKind =
  /** Normal message visible to everyone. */
  | 'chat'
  /** Message from the artists / players who already guessed; only they can see it. */
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

/** Tools that produce strokes. */
export type StrokeTool = 'pen' | 'eraser';
export type Tool = StrokeTool | 'fill';

export interface StrokeOp {
  kind: 'stroke';
  id: string;
  tool: StrokeTool;
  color: string;
  size: number;
  /** Flat [x0, y0, x1, y1, …] integers in 0..COORD_MAX. */
  points: number[];
}

export interface ClearOp {
  kind: 'clear';
  id: string;
}

/** Paint-bucket fill: flood-fills the area around (x, y) with a colour. */
export interface FillOp {
  kind: 'fill';
  id: string;
  color: string;
  /** Normalised point, 0..COORD_MAX. */
  x: number;
  y: number;
}

export type DrawOp = StrokeOp | ClearOp | FillOp;

/** A live piece of a stroke. The first chunk for an id starts the stroke. */
export interface StrokeChunk {
  id: string;
  tool: StrokeTool;
  color: string;
  size: number;
  points: number[];
  final: boolean;
}

export interface WordChoice {
  text: string;
  difficulty: Difficulty;
  category: string;
  language: Language;
}

/** One row of the room browser. */
export interface RoomListing {
  code: string;
  name: string;
  visibility: RoomVisibility;
  players: number;
  maxPlayers: number;
  language: WordLanguage;
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
  quickGuesses: number;
  perfectDrawings: number;
  collabDrawings: number;
  chaosTurns: number;
  votesReceived: number;
  teamWins: number;
  achievements: Achievement[];
}

/** A player's cosmetic profile and what they have unlocked (computed on the server). */
export interface PlayerProfile {
  avatarId: number;
  titleId: string | null;
  unlockedAvatars: number[];
  unlockedTitles: string[];
  /** False when the server has no database: only free avatars are available. */
  persistent: boolean;
}

export interface SessionInfo {
  playerId: string;
  token: string;
}
