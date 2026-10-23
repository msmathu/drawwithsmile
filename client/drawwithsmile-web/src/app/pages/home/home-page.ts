import { ChangeDetectionStrategy, Component, type OnDestroy, type OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LANGUAGES, LIMITS, isValidNickname, roomNameKey, sanitizeNickname, type Language, type RoomDirectory, type RoomListing } from '@dws/shared';
import { ApiService } from '../../core/services/api.service';
import { GameService } from '../../core/services/game.service';
import { PreferencesService, randomNickname } from '../../core/services/preferences.service';
import { SocketService } from '../../core/services/socket.service';
import { CreateRoomDialog, type CreateRoomOptions } from '../../shared/components/create-room-dialog/create-room-dialog';
import { Logo } from '../../shared/components/logo/logo';
import { Modal } from '../../shared/components/modal/modal';
import { RoomList } from '../../shared/components/room-list/room-list';

const REFRESH_MS = 5_000;

@Component({
  selector: 'app-home-page',
  imports: [Logo, RouterLink, RoomList, Modal, CreateRoomDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage implements OnInit, OnDestroy {
  private readonly game = inject(GameService);
  private readonly api = inject(ApiService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  protected readonly prefs = inject(PreferencesService);

  protected readonly languages = LANGUAGES;
  protected readonly maxNickname = LIMITS.NICKNAME_MAX;
  protected readonly nickname = signal(this.prefs.nickname() || randomNickname());
  protected readonly language = signal<Language>(this.prefs.language());
  protected readonly roomQuery = signal('');
  protected readonly privateSearch = signal('');
  protected readonly busy = signal<string | null>(null);
  protected readonly touched = signal(false);
  protected readonly directory = signal<RoomDirectory | null>(null);
  protected readonly loadError = signal(false);
  protected readonly dialog = signal<'create' | 'private' | null>(null);

  protected readonly cleanNickname = computed(() => sanitizeNickname(this.nickname()));
  protected readonly nicknameValid = computed(() => isValidNickname(this.cleanNickname()));
  protected readonly filteredPrivate = computed(() => {
    const query = roomNameKey(this.privateSearch());
    const rooms = this.directory()?.privateRooms ?? [];
    return query ? rooms.filter((r) => roomNameKey(r.name).includes(query)) : rooms;
  });

  private timer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.socket.connect().catch(() => undefined);
    void this.refresh();
    this.timer = setInterval(() => {
      if (document.visibilityState === 'visible') void this.refresh();
    }, REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  protected shuffleName(): void {
    this.nickname.set(randomNickname());
  }

  protected setLanguage(value: string): void {
    const lang: Language = value === 'ta' ? 'ta' : 'en';
    this.language.set(lang);
    this.prefs.setLanguage(lang);
  }

  protected quickPlay(): Promise<void> {
    return this.run('quick', () => this.game.quickPlay(this.cleanNickname(), this.language()));
  }

  protected openCreate(): void {
    this.touched.set(true);
    if (this.nicknameValid()) this.dialog.set('create');
  }

  protected createRoom(options: CreateRoomOptions): Promise<void> {
    return this.run('create', () => this.game.createRoom(this.cleanNickname(), options));
  }

  protected joinByName(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.roomQuery().trim();
    if (!name) return Promise.resolve();
    return this.run('join', () => this.game.joinByName(name, this.cleanNickname()));
  }

  protected joinListed(room: RoomListing): Promise<void> {
    return this.run(room.code, () => this.game.joinRoom(room.code, this.cleanNickname()));
  }

  protected async reportRoom(room: RoomListing): Promise<void> {
    await this.game.reportRoom(room.code);
  }

  protected async refresh(): Promise<void> {
    try {
      this.directory.set(await this.api.rooms());
      this.loadError.set(false);
    } catch {
      this.loadError.set(true);
    }
  }

  private async run(kind: string, action: () => Promise<string | null>): Promise<void> {
    this.touched.set(true);
    if (!this.nicknameValid() || this.busy() !== null) return;
    this.busy.set(kind);
    try {
      const code = await action();
      if (code) {
        this.dialog.set(null);
        await this.router.navigate(['/room', code]);
      } else {
        void this.refresh();
      }
    } finally {
      this.busy.set(null);
    }
  }
}
