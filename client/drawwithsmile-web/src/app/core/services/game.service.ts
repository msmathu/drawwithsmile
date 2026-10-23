import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type {
  AckResponse,
  ChatMessage,
  CreateRoomPayload,
  GamePhase,
  Language,
  ReportReason,
  RoomSettings,
  RoomState,
  WordChoice,
} from '@dws/shared';
import { PreferencesService } from './preferences.service';
import { SessionService } from './session.service';
import { SocketService } from './socket.service';
import { SoundService } from './sound.service';
import { ToastService } from './toast.service';

const MAX_MESSAGES = 150;

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
  /** Players muted on this device only. */
  readonly locallyMuted = signal<ReadonlySet<string>>(new Set());

  readonly playerId = this.session.playerId;
  readonly phase = computed<GamePhase | null>(() => this.state()?.phase ?? null);
  readonly me = computed(() => this.state()?.players.find((p) => p.id === this.playerId()) ?? null);
  readonly isHost = computed(() => this.me()?.isHost ?? false);
  readonly isDrawer = computed(() => {
    const s = this.state();
    return !!s && s.drawerId === this.playerId() && (s.phase === 'choosing' || s.phase === 'drawing');
  });
  readonly drawer = computed(() => {
    const s = this.state();
    return s?.players.find((p) => p.id === s.drawerId) ?? null;
  });

  constructor() {
    this.socket.on('room:state', (state) => this.onState(state));
    this.socket.on('chat:history', (messages) => this.messages.set(messages.filter((m) => this.visible(m))));
    this.socket.on('chat:message', (message) => {
      if (!this.visible(message)) return;
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

  quickPlay(nickname: string, language: Language) {
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
    return this.act(ban ? this.socket.request('mod:ban', { playerId }) : this.socket.request('mod:kick', { playerId }));
  }

  setMuted(playerId: string, muted: boolean) {
    return this.act(this.socket.request('mod:mute', { playerId, muted }));
  }

  voteKick(playerId: string) {
    return this.act(this.socket.request('mod:voteKick', { playerId }), 'Vote recorded.');
  }

  report(playerId: string, reason: ReportReason, details?: string) {
    return this.act(this.socket.request('mod:report', { playerId, reason, details }), 'Thanks — the report was sent.');
  }

  toggleLocalMute(playerId: string): void {
    this.locallyMuted.update((set) => {
      const next = new Set(set);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
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
    this.autoStartDeadline.set(next.autoStartInMs === null ? null : now + next.autoStartInMs);

    const isDrawer = next.drawerId === this.playerId();
    if (next.phase !== 'choosing' || !isDrawer) this.choices.set(null);
    if (next.phase !== 'drawing' || !isDrawer) this.myWord.set(null);

    if (prev?.phase !== next.phase) {
      if (next.phase === 'turnEnd' || next.phase === 'gameEnd') this.sound.play('roundEnd');
    }
    if (prev && next.players.length > prev.players.length && next.phase === 'lobby') this.sound.play('join');
  }

  private visible(message: ChatMessage): boolean {
    return !message.playerId || !this.locallyMuted().has(message.playerId);
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
