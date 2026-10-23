import type { CategoryInfo, LanguageInfo, RoomSettings } from './types.js';

export const GAME_NAME = 'DrawWithSmile';

/** Hard limits enforced by the server. The client uses the same values for UX only. */
export const LIMITS = {
  MAX_PLAYERS: 16,
  MIN_PLAYERS_TO_START: 2,
  NICKNAME_MIN: 2,
  NICKNAME_MAX: 16,
  ROOM_NAME_MIN: 3,
  ROOM_NAME_MAX: 24,
  CHAT_MAX: 100,
  ROOM_CODE_LENGTH: 8,
  /** Normalised coordinates are integers in [0, COORD_MAX]. */
  COORD_MAX: 10_000,
  /** Max x/y pairs in a single live stroke chunk. */
  CHUNK_MAX_POINTS: 120,
  /** Max x/y pairs in one stroke; clients start a new stroke when reached. */
  STROKE_MAX_POINTS: 2_400,
  /** Max drawing operations (strokes + clears) kept for one turn. */
  MAX_OPS_PER_TURN: 1_500,
  /** Max x/y pairs across all strokes in one turn (bounds history size). */
  MAX_POINTS_PER_TURN: 60_000,
  /** Recent public chat messages replayed to reconnecting players. */
  CHAT_HISTORY: 40,
  /** Max Socket.IO message size accepted by the server. */
  MAX_PAYLOAD_BYTES: 16_384,
  REPORT_DETAILS_MAX: 200,
} as const;

export const TIMINGS = {
  CHOOSE_WORD_MS: 15_000,
  TURN_END_MS: 6_000,
  GAME_END_RETURN_MS: 30_000,
  PUBLIC_AUTOSTART_MS: 15_000,
  PUBLIC_FULL_AUTOSTART_MS: 4_000,
  RECONNECT_GRACE_MS: 45_000,
  LOBBY_RECONNECT_GRACE_MS: 20_000,
} as const;

/** 32 characters without look-alikes (0/O, 1/I). 32^8 ≈ 1.1 trillion codes. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

/** Canvas has a fixed logical aspect ratio so every player sees the same picture. */
export const CANVAS_ASPECT = 4 / 3;
/** Brush sizes are expressed in pixels at this reference canvas width. */
export const REFERENCE_CANVAS_WIDTH = 800;
export const BRUSH_SIZES = [3, 6, 12, 20, 34] as const;
export const CANVAS_BACKGROUND = '#ffffff';

export const PALETTE = [
  '#000000', '#4b5563', '#9ca3af', '#ffffff',
  '#ef4444', '#f97316', '#facc15', '#84cc16',
  '#22c55e', '#14b8a6', '#0ea5e9', '#3b82f6',
  '#8b5cf6', '#ec4899', '#92400e', '#fcd5b5',
] as const;

export const SETTINGS_BOUNDS = {
  drawTime: { min: 30, max: 180 },
  rounds: { min: 1, max: 6 },
  maxPlayers: { min: 2, max: LIMITS.MAX_PLAYERS },
} as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  drawTime: 60,
  rounds: 3,
  language: 'en',
  difficulty: 'mixed',
  maxPlayers: 8,
  categories: [],
};

export const WORD_CHOICE_COUNT = 3;

/** Options offered by the Max Players slider when creating a room. */
export const MAX_PLAYER_OPTIONS = [4, 6, 8, 10, 12, 14, 16] as const;

/** Distinct reports after which a room is hidden from the room lists. */
export const ROOM_REPORTS_TO_UNLIST = 3;

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
];

export const CATEGORIES: readonly CategoryInfo[] = [
  { slug: 'animals', label: { en: 'Animals', ta: 'விலங்குகள்' } },
  { slug: 'food', label: { en: 'Food', ta: 'உணவு' } },
  { slug: 'objects', label: { en: 'Objects', ta: 'பொருட்கள்' } },
  { slug: 'movies', label: { en: 'Movies', ta: 'திரைப்படங்கள்' } },
  { slug: 'sports', label: { en: 'Sports', ta: 'விளையாட்டு' } },
  { slug: 'technology', label: { en: 'Technology', ta: 'தொழில்நுட்பம்' } },
];

export const CATEGORY_SLUGS = CATEGORIES.map((c) => c.slug);

export const REPORT_REASONS = [
  'spam',
  'offensive',
  'cheating',
  'inappropriate-drawing',
  'inappropriate-room-name',
  'other',
] as const;

export const AVATAR_COUNT = 12;
