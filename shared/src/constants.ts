import type { CategoryInfo, ChaosRule, Language, LanguageInfo, RoomSettings, VoteCategory } from './types.js';

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
  /** Fills are re-run on every redraw, so they are capped separately. */
  MAX_FILLS_PER_TURN: 60,
  /** Max x/y pairs across all strokes in one turn (bounds history size). */
  MAX_POINTS_PER_TURN: 60_000,
  /** Recent public chat messages replayed to reconnecting players. */
  CHAT_HISTORY: 40,
  /** Max Socket.IO message size accepted by the server. */
  MAX_PAYLOAD_BYTES: 16_384,
  REPORT_DETAILS_MAX: 200,
} as const;

export const TIMINGS = {
  CHOOSE_WORD_MS: 5_000,
  TURN_END_MS: 5_000,
  GAME_END_RETURN_MS: 5_000,
  PUBLIC_AUTOSTART_MS: 5_000,
  PUBLIC_FULL_AUTOSTART_MS: 5_000,
  RECONNECT_GRACE_MS: 45_000,
  LOBBY_RECONNECT_GRACE_MS: 20_000,
  /** How long vote results stay on screen. */
  VOTE_REVEAL_MS: 5_000,
  /** A correct guess within this time after drawing starts counts as a quick guess. */
  QUICK_GUESS_MS: 15_000,
  /** Chaos "wobbly brush": the size changes this often. */
  CHAOS_BRUSH_INTERVAL_MS: 3_000,
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
  artistCount: { min: 2, max: 4 },
  artistSeconds: { min: 10, max: 60 },
  votingSeconds: { min: 10, max: 40 },
  voteBonus: { min: 0, max: 200 },
  teamCount: { min: 2, max: 4 },
  teamBonus: { min: 0, max: 200 },
} as const;

export const CHAOS_RULE_IDS = ['invisible-ink', 'limited-palette', 'flipped-canvas', 'shifting-brush', 'one-stroke'] as const;

export const DEFAULT_SETTINGS: RoomSettings = {
  drawTime: 60,
  rounds: 3,
  language: 'en',
  difficulty: 'mixed',
  maxPlayers: 8,
  categories: [],
  hints: true,
  lateJoin: true,
  mode: 'normal',
  chaosRules: [...CHAOS_RULE_IDS],
  chaosRandom: true,
  collaborative: false,
  artistCount: 2,
  artistSeconds: 15,
  reactions: true,
  voting: false,
  votingSeconds: 20,
  voteBonus: 50,
  teams: false,
  teamCount: 2,
  teamAssignment: 'auto',
  teamScoring: 'total',
  teamBonus: 50,
};

export const WORD_CHOICE_COUNT = 3;

/** Options offered by the Max Players slider when creating a room. */
export const MAX_PLAYER_OPTIONS = [4, 6, 8, 10, 12, 14, 16] as const;

/** Distinct reports after which a room is hidden from the room lists. */
export const ROOM_REPORTS_TO_UNLIST = 3;

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', label: 'English' },
  { code: 'ta', label: 'தமிழ் (Tamil)' },
  { code: 'mixed', label: 'English + தமிழ் (Language Battle)' },
];

/** Languages that have word packs (everything except "mixed"). Add new codes here. */
export const WORD_LANGUAGES: readonly Language[] = ['en', 'ta'];

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

/** Number of free avatars (ids 0..11). Higher ids are unlockable. */
export const AVATAR_COUNT = 12;

/** Temporary ban lengths offered to room admins (minutes). */
export const TEMP_BAN_MINUTES = [5, 30] as const;

export const CHAOS_RULES: readonly { id: ChaosRule; icon: string; name: string; description: string }[] = [
  { id: 'invisible-ink', icon: '👻', name: 'Invisible ink', description: "The drawer can't see the line until the pen is lifted." },
  { id: 'limited-palette', icon: '🎨', name: 'Tiny palette', description: 'Only a few random colours are allowed.' },
  { id: 'flipped-canvas', icon: '🪞', name: 'Mirror hands', description: "The drawer's strokes are mirrored left-right or up-down." },
  { id: 'shifting-brush', icon: '🌀', name: 'Wobbly brush', description: 'The brush size keeps changing by itself.' },
  { id: 'one-stroke', icon: '✍️', name: 'One stroke', description: 'Draw it in one line: no lifting, fill, undo or clear.' },
];

/** Live reactions players can send while someone is drawing. */
export const REACTIONS = ['😂', '❤️', '🔥', '👏', '🤔'] as const;

export const VOTE_CATEGORIES: readonly { id: VoteCategory; icon: string; name: string }[] = [
  { id: 'funniest', icon: '😂', name: 'Funniest drawing' },
  { id: 'creative', icon: '🎨', name: 'Most creative' },
  { id: 'teamwork', icon: '🤝', name: 'Best teamwork' },
];

export const TEAMS: readonly { name: string; color: string }[] = [
  { name: 'Team Coral', color: '#ff6b6b' },
  { name: 'Team Teal', color: '#1fb5a8' },
  { name: 'Team Sun', color: '#f5a700' },
  { name: 'Team Grape', color: '#8e6cef' },
];

/** Achievement definitions. Only the server decides when they are earned. */
export const ACHIEVEMENTS: readonly { code: string; name: string; description: string }[] = [
  { code: 'FIRST_GAME', name: 'First Smile', description: 'Finish your first game.' },
  { code: 'FIRST_WIN', name: 'Champion', description: 'Win a game.' },
  { code: 'HIGH_SCORER', name: 'High Scorer', description: 'Score 1000 points or more in one game.' },
  { code: 'SHARP_EYE', name: 'Sharp Eye', description: 'Guess 50 words correctly.' },
  { code: 'ARTIST', name: 'Artist', description: 'Draw 25 words.' },
  { code: 'VETERAN', name: 'Veteran', description: 'Play 25 games.' },
  { code: 'QUICK_GUESSER', name: 'Quick Guesser', description: 'Guess 10 words within 15 seconds of the drawing starting.' },
  { code: 'MASTER_DOODLER', name: 'Master Doodler', description: 'Have 10 of your drawings guessed by everyone.' },
  { code: 'TEAM_CHAMPION', name: 'Team Champion', description: 'Win a Team Battle.' },
  { code: 'CHAOS_SURVIVOR', name: 'Chaos Survivor', description: 'Guess or get your drawing guessed in 5 Chaos turns.' },
  { code: 'TEAM_PLAYER', name: 'Team Player', description: 'Share the pen in 3 collaborative drawings.' },
  { code: 'CREATIVE_LEGEND', name: 'Creative Legend', description: 'Receive 10 votes for your drawings.' },
];

/** Unlockable avatars (ids from AVATAR_COUNT up). Free avatars are 0..AVATAR_COUNT-1. */
export const UNLOCKABLE_AVATARS: readonly { id: number; name: string; unlock: string }[] = [
  { id: 12, name: 'Party Smile', unlock: 'FIRST_GAME' },
  { id: 13, name: 'Cool Shades', unlock: 'FIRST_WIN' },
  { id: 14, name: 'Lightning', unlock: 'QUICK_GUESSER' },
  { id: 15, name: 'Painter', unlock: 'ARTIST' },
  { id: 16, name: 'Royal', unlock: 'HIGH_SCORER' },
  { id: 17, name: 'Captain', unlock: 'TEAM_CHAMPION' },
  { id: 18, name: 'Wild Hair', unlock: 'CHAOS_SURVIVOR' },
  { id: 19, name: 'Star Eyes', unlock: 'CREATIVE_LEGEND' },
  { id: 20, name: 'Headphones', unlock: 'TEAM_PLAYER' },
  { id: 21, name: 'Wizard', unlock: 'VETERAN' },
];

export const TITLES: readonly { id: string; name: string; unlock: string }[] = [
  { id: 'beginner-artist', name: 'Beginner Artist', unlock: 'FIRST_GAME' },
  { id: 'champion', name: 'Champion', unlock: 'FIRST_WIN' },
  { id: 'quick-guesser', name: 'Quick Guesser', unlock: 'QUICK_GUESSER' },
  { id: 'master-doodler', name: 'Master Doodler', unlock: 'MASTER_DOODLER' },
  { id: 'team-champion', name: 'Team Champion', unlock: 'TEAM_CHAMPION' },
  { id: 'chaos-survivor', name: 'Chaos Survivor', unlock: 'CHAOS_SURVIVOR' },
  { id: 'team-player', name: 'Team Player', unlock: 'TEAM_PLAYER' },
  { id: 'creative-legend', name: 'Creative Legend', unlock: 'CREATIVE_LEGEND' },
  { id: 'veteran', name: 'Veteran', unlock: 'VETERAN' },
];

export function titleName(id: string | null | undefined): string | null {
  return TITLES.find((t) => t.id === id)?.name ?? null;
}

/** Avatars a player may use, given the achievement codes they have earned. */
export function unlockedAvatarIds(earned: ReadonlySet<string>): number[] {
  const free = Array.from({ length: AVATAR_COUNT }, (_, i) => i);
  return [...free, ...UNLOCKABLE_AVATARS.filter((a) => earned.has(a.unlock)).map((a) => a.id)];
}

export function unlockedTitleIds(earned: ReadonlySet<string>): string[] {
  return TITLES.filter((t) => earned.has(t.unlock)).map((t) => t.id);
}

/**
 * Checks combinations of room rules (ranges are checked by the server schema).
 * Returns a message explaining the problem, or null when the settings work together.
 */
export function validateSettings(s: RoomSettings, playerCount = 0): string | null {
  if (playerCount > s.maxPlayers) return `There are already ${playerCount} players in the room.`;
  if (s.mode === 'chaos' && s.chaosRules.length === 0) return 'Choose at least one Chaos challenge, or switch to Normal mode.';
  if (s.teams && s.collaborative) {
    return 'Team Battle and collaborative drawing cannot be combined yet. Turn one of them off.';
  }
  if (s.teams && s.maxPlayers < s.teamCount * 2) {
    return `Team Battle with ${s.teamCount} teams needs Max players of at least ${s.teamCount * 2}.`;
  }
  if (s.collaborative && s.artistSeconds >= s.drawTime) {
    return "Each artist's time with the pen must be shorter than the draw time.";
  }
  if (s.collaborative && s.maxPlayers < s.artistCount + 1) {
    return `Collaborative drawing with ${s.artistCount} artists needs Max players of at least ${s.artistCount + 1}.`;
  }
  return null;
}
