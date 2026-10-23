import type { Difficulty, Language, RoomVisibility, TurnEndReason } from '@dws/shared';

/** A word the game can use. `id` is null for built-in fallback words. */
export interface WordEntry {
  id: number | null;
  text: string;
  difficulty: Difficulty;
  category: string;
  language: Language;
}

export interface TurnRecord {
  round: number;
  turnNumber: number;
  drawerId: string;
  wordId: number | null;
  wordText: string;
  correctGuesses: number;
  endReason: TurnEndReason;
  startedAt: Date;
  endedAt: Date;
}

export interface PlayerResultRecord {
  playerId: string;
  nickname: string;
  finalScore: number;
  rank: number;
  correctGuesses: number;
  drawings: number;
  isWinner: boolean;
}

/** Everything persisted when a game finishes. */
export interface GameSummary {
  sessionId: string;
  roomCode: string;
  visibility: RoomVisibility;
  language: Language;
  totalRounds: number;
  drawTime: number;
  completed: boolean;
  startedAt: Date;
  endedAt: Date;
  players: PlayerResultRecord[];
  turns: TurnRecord[];
}

export type ModerationActionType = 'kick' | 'ban' | 'mute' | 'unmute' | 'vote-kick';
