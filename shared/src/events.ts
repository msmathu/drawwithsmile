import type {
  ChatMessage,
  ClearOp,
  DrawOp,
  Language,
  RoomSettings,
  RoomVisibility,
  RoomState,
  StrokeChunk,
  WordChoice,
} from './types.js';
import type { REPORT_REASONS } from './constants.js';

export type ErrorCode =
  | 'bad-request'
  | 'unauthorized'
  | 'not-found'
  | 'room-full'
  | 'game-in-progress'
  | 'banned'
  | 'not-host'
  | 'not-drawer'
  | 'not-in-room'
  | 'wrong-phase'
  | 'not-enough-players'
  | 'rate-limited'
  | 'muted'
  | 'server-error';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

export type AckResponse<T = null> = { ok: true; data: T } | { ok: false; error: ErrorPayload };
export type Ack<T = null> = (response: AckResponse<T>) => void;

export type ReportReason = (typeof REPORT_REASONS)[number];

export interface JoinResult {
  code: string;
}

export interface CreateRoomPayload {
  nickname: string;
  /** Defaults to private. */
  visibility?: RoomVisibility;
  /** Custom room name; omitted = random name like "The Kitten Room". */
  name?: string;
  /** Private rooms: show in the private room list (default true). */
  listed?: boolean;
  settings?: Partial<RoomSettings>;
}

/** Events the server sends. Every event carries exactly one payload argument. */
export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:kicked': (payload: { reason: string }) => void;
  'session:replaced': (payload: { message: string }) => void;
  'chat:message': (message: ChatMessage) => void;
  'chat:history': (messages: ChatMessage[]) => void;
  'draw:history': (ops: DrawOp[]) => void;
  'draw:chunk': (chunk: StrokeChunk) => void;
  'draw:undo': (payload: { opId: string }) => void;
  'draw:redo': (op: DrawOp) => void;
  'draw:clear': (op: ClearOp) => void;
  'turn:choices': (payload: { choices: WordChoice[]; remainingMs: number }) => void;
  'turn:word': (payload: { word: string }) => void;
  'notice': (payload: ErrorPayload) => void;
}

/** Events the client sends. The server validates every payload. */
export interface ClientToServerEvents {
  'room:quickPlay': (payload: { nickname: string; language: Language }, ack: Ack<JoinResult>) => void;
  'room:create': (payload: CreateRoomPayload, ack: Ack<JoinResult>) => void;
  /** Join a listed room by its display name (or an exact room code). */
  'room:joinByName': (payload: { name: string; nickname: string }, ack: Ack<JoinResult>) => void;
  'room:join': (payload: { code: string; nickname: string }, ack: Ack<JoinResult>) => void;
  'room:leave': (ack: Ack) => void;
  'room:updateSettings': (payload: Partial<RoomSettings>, ack: Ack) => void;
  'game:start': (ack: Ack) => void;
  'game:chooseWord': (payload: { index: number }, ack: Ack) => void;
  'game:backToLobby': (ack: Ack) => void;
  'draw:chunk': (chunk: StrokeChunk) => void;
  'draw:undo': () => void;
  'draw:redo': () => void;
  'draw:clear': () => void;
  'chat:send': (payload: { text: string }, ack: Ack) => void;
  'mod:kick': (payload: { playerId: string }, ack: Ack) => void;
  'mod:ban': (payload: { playerId: string }, ack: Ack) => void;
  'mod:mute': (payload: { playerId: string; muted: boolean }, ack: Ack) => void;
  'mod:voteKick': (payload: { playerId: string }, ack: Ack) => void;
  'mod:reportRoom': (payload: { code: string }, ack: Ack) => void;
  'mod:report': (payload: { playerId: string; reason: ReportReason; details?: string }, ack: Ack) => void;
}

export type ServerEventName = keyof ServerToClientEvents;
export type ServerEventPayload<E extends ServerEventName> = Parameters<ServerToClientEvents[E]>[0];
