import { Injectable, inject, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import type { Ack, AckResponse, ClientToServerEvents, ServerToClientEvents } from '@dws/shared';
import { ACK_TIMEOUT_MS, API_URL } from '../config';
import { SessionService } from './session.service';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'banned';

type ClientEvents = ClientToServerEvents;
/** Client events whose last argument is an acknowledgement callback. */
type AckEvent = {
  [E in keyof ClientEvents]: ClientEvents[E] extends (...args: infer A) => void
    ? A extends [...unknown[], (response: never) => void]
      ? E
      : never
    : never;
}[keyof ClientEvents];
type ArgsOf<E extends AckEvent> = ClientEvents[E] extends (...args: [...infer A, infer _L]) => void ? A : never;
type ResultOf<E extends AckEvent> = ClientEvents[E] extends (...args: [...infer _A, infer L]) => void
  ? L extends Ack<infer R>
    ? R
    : never
  : never;
type FireEvent = Exclude<keyof ClientEvents, AckEvent>;

/** Typed Socket.IO connection with automatic reconnection and session renewal. */
@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly session = inject(SessionService);
  readonly status = signal<ConnectionStatus>('idle');
  /** Increments on every successful (re)connection. */
  readonly connections = signal(0);

  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(API_URL || undefined, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 800,
    reconnectionDelayMax: 5_000,
    timeout: 10_000,
    auth: (cb) => cb({ token: this.session.getToken() }),
  });
  private starting: Promise<void> | null = null;
  /** This tab was taken over by the same player in another tab. */
  private replaced = false;

  constructor() {
    this.socket.on('connect', () => {
      this.status.set('connected');
      this.connections.update((n) => n + 1);
    });
    this.socket.on('disconnect', (reason) => {
      if (this.status() === 'banned') return;
      this.status.set(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
      // The server only disconnects us on purpose. After a kick/ban, reconnect once so a ban
      // is detected; a tab replaced by a newer one stays disconnected (no tug of war).
      if (reason === 'io server disconnect' && !this.replaced) setTimeout(() => this.socket.connect(), 1_000);
    });
    this.socket.on('session:replaced', () => (this.replaced = true));
    this.socket.on('connect_error', (err) => {
      if (err.message === 'banned') {
        // Permanently banned: stop retrying.
        this.status.set('banned');
        this.socket.disconnect();
        return;
      }
      this.status.set(this.connections() > 0 ? 'reconnecting' : 'connecting');
      if (err.message === 'unauthorized') {
        // Token rejected (e.g. server secret rotated): get a fresh session and retry.
        void this.session.ensure().then(() => this.socket.connect(), () => undefined);
      } else if (!this.socket.active) {
        setTimeout(() => this.socket.connect(), 3_000);
      }
    });
  }

  /** Connects once a session exists. Safe to call repeatedly. */
  connect(): Promise<void> {
    if (this.socket.connected) return Promise.resolve();
    if (this.status() === 'banned') return Promise.reject(new Error('banned'));
    this.starting ??= (async () => {
      this.status.set('connecting');
      try {
        await this.session.ensure();
      } catch (err) {
        if (err instanceof Error && err.message === 'banned') {
          this.status.set('banned');
          throw err;
        }
        // Session endpoint busy or unreachable: with a saved identity, let the game
        // server decide (it also answers "banned" or "unauthorized").
        if (!this.session.getToken()) throw err;
      }
      if (!this.socket.connected) this.socket.connect();
      await new Promise<void>((resolve) => {
        if (this.socket.connected) return resolve();
        this.socket.once('connect', () => resolve());
      });
    })().finally(() => (this.starting = null));
    return this.starting;
  }

  on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]): void {
    (this.socket.on as (ev: string, fn: unknown) => void)(event, handler);
  }

  /** Emits an event and resolves with the server's acknowledgement (or a timeout error). */
  async request<E extends AckEvent>(event: E, ...args: ArgsOf<E>): Promise<AckResponse<ResultOf<E>>> {
    try {
      await this.withTimeout(this.connect(), 15_000);
    } catch {
      return { ok: false, error: { code: 'server-error', message: 'Cannot reach the game server. Check your connection.' } };
    }
    return new Promise((resolve) => {
      const target = this.socket.timeout(ACK_TIMEOUT_MS);
      (target.emit as unknown as (...a: unknown[]) => void).call(target, event, ...args, (err: Error | null, res: AckResponse<ResultOf<E>>) =>
        resolve(err ? { ok: false, error: { code: 'server-error', message: 'The server did not respond. Please try again.' } } : res),
      );
    });
  }

  /** Fire-and-forget events (drawing). Dropped while disconnected. */
  send<E extends FireEvent>(event: E, ...args: Parameters<ClientEvents[E]>): void {
    if (!this.socket.connected) return;
    (this.socket.emit as (ev: string, ...a: unknown[]) => void)(event, ...args);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => (clearTimeout(timer), resolve(v)),
        (e: unknown) => (clearTimeout(timer), reject(e)),
      );
    });
  }
}
