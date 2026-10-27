import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AckResponse,
  ChatMessage,
  CreateRoomPayload,
  GamePhase,
  ReactionEmoji,
  ReportReason,
  RoomSettings,
  RoomState,
  VoteCategory,
  WordChoice,
  WordLanguage,
} from '@dws/shared';
import { PreferencesService } from './preferences.service';
import { StorageService } from './storage.service';
import { SessionService } from './session.service';
import { SocketService } from './socket.service';
import { SoundService } from './sound.service';
import { ToastService } from './toast.service';

const MAX_MESSAGES = 150;
const MUTED_KEY = 'dws.muted';

/** Removes messages written by muted players (system messages always stay). */
export function filterMuted(messages: readonly ChatMessage[], muted: ReadonlySet<string>): ChatMessage[] {
  return muted.size === 0 ? [...messages] : messages.filter((m) => !m.playerId || !muted.has(m.playerId));
}

function loadMuted(raw: string | null): ReadonlySet<string> {
  try {
    const list: unknown = JSON.parse(raw ?? '[]');
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
const FLOAT_MS = 2_400;

/** An emoji floating up over the canvas. */
export interface FloatingReaction {
  id: number;
  emoji: string;
  /** Horizontal position, 0–100 %. */
  x: number;
}

/**
 * Client-side store for the current room. All game rules run on the server;
 * this service only mirrors server state into signals and sends player intents.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  private readonly socket = inject(SocketService);
  private readonly session = inject(SessionService);
  private readonly prefs = inject(PreferencesService);
  private readonly toast = inject(ToastService);
  private readonly sound = inject(SoundService);
  private readonly router = inject(Router);

  readonly state = signal<RoomState | null>(null);
  readonly messages = signal<ChatMessage[]>([]);
  readonly myWord = signal<string | null>(null);
  readonly choices = signal<WordChoice[] | null>(null);
  /** Local deadlines (Date.now() based), derived from server "remaining ms" values. */
  readonly phaseDeadline = signal<number | null>(null);
  readonly autoStartDeadline = signal<number | null>(null);
  private readonly storage = inject(StorageService);
  /** Players muted on this device only (remembered across visits). */
  readonly locallyMuted = signal<ReadonlySet<string>>(loadMuted(this.storage.get(MUTED_KEY)));
  /** Players this device has already reported. */
  readonly reported = signal<ReadonlySet<string>>(new Set());
  /** Chat without messages from muted players — muting also hides what they said earlier. */
  readonly visibleMessages = computed(() => filterMuted(this.messages(), this.locallyMuted()));
  /** Collaborative mode: when the pen passes to the next artist. */
  readonly penDeadline = signal<number | null>(null);
  readonly floatingReactions = signal<FloatingReaction[]>([]);
  /** This device's votes in the current voting round (category -> turn number). */
  readonly myVotes = signal<Partial<Record<VoteCategory, number>>>({});
  /** Small pictures of finished drawings, captured locally for the vote (turn number -> data URL). */
  readonly thumbnails = signal<ReadonlyMap<number, string>>(new Map());
  private nextFloatId = 1;

  readonly playerId = this.session.playerId;
  readonly phase = computed<GamePhase | null>(() => this.state()?.phase ?? null);
  readonly me = computed(() => this.state()?.players.find((p) => p.id === this.playerId()) ?? null);
  readonly isHost = computed(() => this.me()?.isHost ?? false);
  /** Choosing the word, or holding the pen right now. */
  readonly isDrawer = computed(() => {
    const s = this.state();
    if (!s) return false;
    if (s.phase === 'choosing') return s.drawerId === this.playerId();
    return s.phase === 'drawing' && s.currentArtistId === this.playerId();
  });
  /** Allowed to draw on the canvas right now. */
  readonly canDraw = computed(() => this.state()?.phase === 'drawing' && this.state()?.currentArtistId === this.playerId());
  /** One of this turn's artists (knows the word, may wait for the pen). */
  readonly isArtist = computed(() => !!this.state()?.artistIds.includes(this.playerId() ?? ''));
  readonly currentArtist = computed(() => {
    const s = this.state();
    return s?.players.find((p) => p.id === s.currentArtistId) ?? null;
  });
  readonly drawer = computed(() => {
    const s = this.state();
    return s?.players.find((p) => p.id === s.drawerId) ?? null;
  });

  constructor() {
    this.socket.on('room:state', (state) => this.onState(state));
    this.socket.on('chat:history', (messages) => this.messages.set(messages));
    this.socket.on('chat:message', (message) => {
      this.messages.update((list) => [...list.slice(-(MAX_MESSAGES - 1)), message]);
      if (message.kind === 'correct') this.sound.play('correct');
    });
    this.socket.on('turn:choices', ({ choices }) => {
      this.choices.set(choices);
      this.sound.play('yourTurn');
    });
    this.socket.on('turn:word', ({ word }) => this.myWord.set(word));
    this.socket.on('room:kicked', ({ reason }) => {
      this.reset();
      this.toast.error(reason);
      void this.router.navigateByUrl('/');
    });
    this.socket.on('session:replaced', ({ message }) => {
      this.reset();
      this.toast.error(message);
      void this.router.navigateByUrl('/');
    });
    this.socket.on('notice', ({ message }) => this.toast.error(message));
    this.socket.on('reaction', ({ playerId, emoji }) => {
      if (!this.locallyMuted().has(playerId)) this.float(emoji);
    });

    // After a reconnect, make sure we are still in our room (the server may have restarted).
    effect(() => {
      const connections = this.socket.connections();
      untracked(() => {
        const current = this.state();
        if (connections > 1 && current) void this.rejoin(current.code);
      });
    });
  }

  // ------------------------------------------------------------ room actions

  quickPlay(nickname: string, language: WordLanguage) {
    return this.enter(this.socket.request('room:quickPlay', { nickname, language }), nickname);
  }

  createRoom(nickname: string, options: Omit<CreateRoomPayload, 'nickname'>) {
    return this.enter(this.socket.request('room:create', { nickname, ...options }), nickname);
  }

  /** Joins a listed room by its name, or any room by its code. */
  joinByName(name: string, nickname: string) {
    return this.enter(this.socket.request('room:joinByName', { name, nickname }), nickname);
  }

  reportRoom(code: string) {
    return this.act(this.socket.request('mod:reportRoom', { code }), 'Thanks — the room name was reported.');
  }

  joinRoom(code: string, nickname: string) {
    return this.enter(this.socket.request('room:join', { code, nickname }), nickname);
  }

  async leave(): Promise<void> {
    this.reset();
    await this.socket.request('room:leave');
  }

  start() {
    return this.act(this.socket.request('game:start'));
  }

  chooseWord(index: number) {
    return this.act(this.socket.request('game:chooseWord', { index }));
  }

  updateSettings(patch: Partial<RoomSettings>) {
    return this.act(this.socket.request('room:updateSettings', patch));
  }

  backToLobby() {
    return this.act(this.socket.request('game:backToLobby'));
  }

  sendChat(text: string) {
    return this.act(this.socket.request('chat:send', { text }));
  }

  kick(playerId: string, ban: boolean) {
    return this.act(ban ? this.socket.request('mod:ban', { playerId, minutes: 5 }) : this.socket.request('mod:kick', { playerId }));
  }

  /** Room admin: temporary ban from this room only. */
  banFor(playerId: string, minutes: number) {
    return this.act(this.socket.request('mod:ban', { playerId, minutes }), `Banned for ${minutes} minutes.`);
  }

  setMuted(playerId: string, muted: boolean) {
    return this.act(this.socket.request('mod:mute', { playerId, muted }));
  }

  voteKick(playerId: string) {
    return this.act(this.socket.request('mod:voteKick', { playerId }), 'Vote recorded.');
  }

  async report(playerId: string, reason: ReportReason, details?: string): Promise<boolean> {
    const ok = await this.act(this.socket.request('mod:report', { playerId, reason, details }), 'Thanks — the report was sent.');
    // Also remember "already reported" answers so the button shows the right state.
    this.reported.update((set) => new Set(set).add(playerId));
    return ok;
  }

  /** Collaborative mode: hand the pen to the next artist now. */
  passPen(): void {
    this.socket.send('draw:pass');
  }

  react(emoji: ReactionEmoji): void {
    this.socket.send('reaction:send', { emoji });
  }

  async vote(category: VoteCategory, turnNumber: number): Promise<void> {
    if (await this.act(this.socket.request('vote:cast', { category, turnNumber }))) {
      this.myVotes.update((v) => ({ ...v, [category]: turnNumber }));
    }
  }

  joinTeam(team: number) {
    return this.act(this.socket.request('team:join', { team }));
  }

  balanceTeams() {
    return this.act(this.socket.request('team:balance'));
  }

  /** Stores a thumbnail of a finished drawing for the end-of-round vote. */
  saveThumbnail(turnNumber: number, dataUrl: string): void {
    this.thumbnails.update((map) => new Map(map).set(turnNumber, dataUrl));
  }

  /** Mute/unmute a player for this device only: their chat and reactions disappear. */
  toggleLocalMute(playerId: string): void {
    this.locallyMuted.update((set) => {
      const next = new Set(set);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
    this.storage.set(MUTED_KEY, JSON.stringify([...this.locallyMuted()].slice(-200)));
  }

  // ------------------------------------------------------------ internals

  private async enter(request: Promise<AckResponse<{ code: string }>>, nickname: string): Promise<string | null> {
    const res = await request;
    if (!res.ok) {
      this.toast.error(res.error.message);
      return null;
    }
    this.prefs.setNickname(nickname);
    return res.data.code;
  }

  private async act(request: Promise<AckResponse<null>>, successMessage?: string): Promise<boolean> {
    const res = await request;
    if (!res.ok) {
      this.toast.error(res.error.message);
      return false;
    }
    if (successMessage) this.toast.show(successMessage, 'success');
    return true;
  }

  private async rejoin(code: string): Promise<void> {
    const nickname = this.me()?.nickname ?? this.prefs.nickname();
    const res = await this.socket.request('room:join', { code, nickname });
    if (!res.ok) {
      this.reset();
      this.toast.error('Your room is no longer available.');
      void this.router.navigateByUrl('/');
    }
  }

  private onState(next: RoomState): void {
    const prev = this.state();
    if (prev && prev.code !== next.code) this.messages.set([]);
    this.state.set(next);

    const now = Date.now();
    this.phaseDeadline.set(next.phaseRemainingMs === null ? null : now + next.phaseRemainingMs);
    this.penDeadline.set(next.artistRemainingMs === null ? null : now + next.artistRemainingMs);
    if (next.phase !== 'voting') this.myVotes.set({});
    if (next.phase === 'lobby' || (prev && prev.code !== next.code)) this.thumbnails.set(new Map());
    if (prev?.phase === 'drawing' && next.phase === 'drawing' && prev.currentArtistId !== next.currentArtistId) {
      if (next.currentArtistId === this.playerId()) this.sound.play('yourTurn');
    }
    this.autoStartDeadline.set(next.autoStartInMs === null ? null : now + next.autoStartInMs);

    const me = this.playerId() ?? '';
    if (next.phase !== 'choosing' || next.drawerId !== me) this.choices.set(null);
    // Every artist of a collaborative drawing keeps the word, not only the one who chose it.
    if (next.phase !== 'drawing' || !next.artistIds.includes(me)) this.myWord.set(null);

    if (prev?.phase !== next.phase) {
      if (next.phase === 'turnEnd' || next.phase === 'gameEnd') this.sound.play('roundEnd');
    }
    if (prev && next.players.length > prev.players.length && next.phase === 'lobby') this.sound.play('join');
  }

  private float(emoji: string): void {
    const item = { id: this.nextFloatId++, emoji, x: 10 + Math.random() * 80 };
    this.floatingReactions.update((list) => [...list.slice(-20), item]);
    setTimeout(() => this.floatingReactions.update((list) => list.filter((r) => r.id !== item.id)), FLOAT_MS);
  }


  private reset(): void {
    this.state.set(null);
    this.messages.set([]);
    this.myWord.set(null);
    this.choices.set(null);
    this.phaseDeadline.set(null);
    this.autoStartDeadline.set(null);
  }
}
