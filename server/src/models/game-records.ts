import type { Difficulty, Language, RoomSettings, RoomVisibility, TurnEndReason, WordLanguage } from '@dws/shared';

/** A word the game can use. `id` is null for built-in fallback words. */
export interface WordEntry {
  id: number | null;
  text: string;
  difficulty: Difficulty;
  category: string;
  language: Language;
  /** Other accepted answers: synonyms, spelling variants, transliterations. */
  accepted: string[];
}

export interface TurnRecord {
  round: number;
  turnNumber: number;
  drawerId: string;
  artistIds: string[];
  wordId: number | null;
  wordText: string;
  correctGuesses: number;
  endReason: TurnEndReason;
  startedAt: Date;
  endedAt: Date;
}

/** Per-player numbers collected during a game; they feed statistics and achievements. */
export interface PlayerGameStats {
  correctGuesses: number;
  drawings: number;
  /** Correct guesses within QUICK_GUESS_MS of the drawing starting. */
  quickGuesses: number;
  /** Drawings (as an artist) that every guesser got. */
  perfectDrawings: number;
  /** Drawings shared with other artists. */
  collabDrawings: number;
  /** Chaos turns where the player guessed, or drew something that was guessed. */
  chaosTurns: number;
  votesReceived: number;
}

export interface PlayerResultRecord extends PlayerGameStats {
  playerId: string;
  nickname: string;
  finalScore: number;
  rank: number;
  isWinner: boolean;
  team: number | null;
  teamWin: boolean;
}

/** Everything persisted when a game finishes. */
export interface GameSummary {
  sessionId: string;
  roomCode: string;
  visibility: RoomVisibility;
  language: WordLanguage;
  totalRounds: number;
  drawTime: number;
  completed: boolean;
  startedAt: Date;
  endedAt: Date;
  /** The room rules used for this game. */
  rules: RoomSettings;
  players: PlayerResultRecord[];
  turns: TurnRecord[];
}

export type ModerationActionType = 'kick' | 'ban' | 'mute' | 'unmute' | 'vote-kick';
