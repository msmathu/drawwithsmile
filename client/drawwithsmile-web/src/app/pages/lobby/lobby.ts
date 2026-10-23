import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  CATEGORIES,
  LANGUAGES,
  LIMITS,
  SETTINGS_BOUNDS,
  type DifficultySetting,
  type Language,
  type RoomSettings,
  type RoomState,
} from '@dws/shared';
import { ClockService } from '../../core/services/clock.service';
import { GameService } from '../../core/services/game.service';
import { ToastService } from '../../core/services/toast.service';
import { ChatPanel } from '../../shared/components/chat-panel/chat-panel';
import { PlayerList } from '../../shared/components/player-list/player-list';

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];

@Component({
  selector: 'app-lobby',
  imports: [PlayerList, ChatPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lobby.html',
  styleUrl: './lobby.css',
})
export class Lobby {
  protected readonly game = inject(GameService);
  private readonly clock = inject(ClockService);
  private readonly toast = inject(ToastService);

  readonly state = input.required<RoomState>();
  readonly leave = output<void>();

  protected readonly languages = LANGUAGES;
  protected readonly categories = CATEGORIES;
  protected readonly drawTimes = DRAW_TIMES;
  protected readonly roundOptions = range(SETTINGS_BOUNDS.rounds.min, SETTINGS_BOUNDS.rounds.max);
  protected readonly playerOptions = range(SETTINGS_BOUNDS.maxPlayers.min, SETTINGS_BOUNDS.maxPlayers.max);
  protected readonly difficulties: { value: DifficultySetting; label: string }[] = [
    { value: 'mixed', label: 'Mixed (one of each)' },
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ];
  protected readonly starting = signal(false);

  protected readonly isPublic = computed(() => this.state().visibility === 'public');
  protected readonly canEdit = computed(() => !this.isPublic() && this.game.isHost());
  protected readonly connected = computed(() => this.state().players.filter((p) => p.connected).length);
  protected readonly canStart = computed(() => this.connected() >= LIMITS.MIN_PLAYERS_TO_START);
  protected readonly autoStartSeconds = computed(() => this.clock.secondsUntil(this.game.autoStartDeadline()));
  protected readonly inviteLink = computed(() => `${location.origin}/room/${this.state().code}`);
  protected readonly host = computed(() => this.state().players.find((p) => p.isHost)?.nickname ?? 'the host');
  protected readonly languageLabel = computed(
    () => LANGUAGES.find((l) => l.code === this.state().settings.language)?.label ?? '',
  );
  protected readonly categoryLabel = computed(() => {
    const selected = this.state().settings.categories;
    if (selected.length === 0) return 'All categories';
    return CATEGORIES.filter((c) => selected.includes(c.slug))
      .map((c) => c.label.en)
      .join(', ');
  });

  protected update(patch: Partial<RoomSettings>): void {
    void this.game.updateSettings(patch);
  }

  protected setNumber(key: 'drawTime' | 'rounds' | 'maxPlayers', value: string): void {
    this.update({ [key]: Number(value) });
  }

  protected setLanguage(value: string): void {
    this.update({ language: value as Language });
  }

  protected setDifficulty(value: string): void {
    this.update({ difficulty: value as DifficultySetting });
  }

  protected toggleCategory(slug: string): void {
    const current = this.state().settings.categories;
    this.update({ categories: current.includes(slug) ? current.filter((c) => c !== slug) : [...current, slug] });
  }

  protected async start(): Promise<void> {
    this.starting.set(true);
    await this.game.start();
    this.starting.set(false);
  }

  protected async share(): Promise<void> {
    const url = this.inviteLink();
    const text = `Join my DrawWithSmile room! Code: ${this.state().code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DrawWithSmile', text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.toast.show('Invite link copied!', 'success');
    } catch {
      /* user cancelled sharing */
    }
  }

  protected async copyCode(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.state().code);
      this.toast.show('Room code copied!', 'success');
    } catch {
      this.toast.error('Could not copy — please copy the code manually.');
    }
  }
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
