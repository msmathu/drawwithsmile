import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import {
  CATEGORIES,
  CHAOS_RULES,
  LANGUAGES,
  LIMITS,
  SETTINGS_BOUNDS,
  TEAMS,
  type ChaosRule,
  type DifficultySetting,
  type RoomSettings,
  type RoomState,
  type WordLanguage,
} from '@dws/shared';
import { DRAWING_PRACTICE_MODE, DrawingService } from '../../core/drawing/drawing.service';
import { ClockService } from '../../core/services/clock.service';
import { GameService } from '../../core/services/game.service';
import { ToastService } from '../../core/services/toast.service';
import { Avatar } from '../../shared/components/avatar/avatar';
import { CanvasBoard } from '../../shared/components/canvas-board/canvas-board';
import { ChatPanel } from '../../shared/components/chat-panel/chat-panel';
import { DrawingToolbar } from '../../shared/components/drawing-toolbar/drawing-toolbar';
import { PlayerList } from '../../shared/components/player-list/player-list';
import { rulesSummary } from '../../shared/rules';

const DRAW_TIMES = [30, 45, 60, 80, 100, 120, 150, 180];
const ARTIST_SECONDS = [10, 15, 20, 30, 45, 60];
const VOTING_SECONDS = [10, 15, 20, 30, 40];
const BONUSES = [0, 25, 50, 100, 150, 200];

@Component({
  selector: 'app-lobby',
  imports: [PlayerList, ChatPanel, CanvasBoard, DrawingToolbar, Avatar],
  // A private practice canvas: its own DrawingService that never talks to the server.
  providers: [{ provide: DRAWING_PRACTICE_MODE, useValue: true }, DrawingService],
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
  protected readonly chaosRules = CHAOS_RULES;
  protected readonly teamInfo = TEAMS;
  protected readonly drawTimes = DRAW_TIMES;
  protected readonly artistSecondsOptions = ARTIST_SECONDS;
  protected readonly votingSecondsOptions = VOTING_SECONDS;
  protected readonly bonusOptions = BONUSES;
  protected readonly roundOptions = range(SETTINGS_BOUNDS.rounds.min, SETTINGS_BOUNDS.rounds.max);
  protected readonly playerOptions = range(SETTINGS_BOUNDS.maxPlayers.min, SETTINGS_BOUNDS.maxPlayers.max);
  protected readonly artistOptions = range(SETTINGS_BOUNDS.artistCount.min, SETTINGS_BOUNDS.artistCount.max);
  protected readonly teamCountOptions = range(SETTINGS_BOUNDS.teamCount.min, SETTINGS_BOUNDS.teamCount.max);
  protected readonly difficulties: { value: DifficultySetting; label: string }[] = [
    { value: 'mixed', label: 'Mixed (one of each)' },
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ];
  protected readonly starting = signal(false);

  protected readonly s = computed(() => this.state().settings);
  protected readonly isPublic = computed(() => this.state().visibility === 'public');
  /** The room admin (creator) edits rules in public and private rooms. */
  protected readonly canEdit = computed(() => this.game.isHost());
  protected readonly connected = computed(() => this.state().players.filter((p) => p.connected).length);
  protected readonly canStart = computed(() => this.connected() >= LIMITS.MIN_PLAYERS_TO_START);
  protected readonly autoStartSeconds = computed(() => this.clock.secondsUntil(this.game.autoStartDeadline()));
  protected readonly inviteLink = computed(() => `${location.origin}/room/${this.state().code}`);
  protected readonly host = computed(() => this.state().players.find((p) => p.isHost)?.nickname ?? 'the host');
  protected readonly summary = computed(() => rulesSummary(this.s()));
  protected readonly teamCapacity = computed(() => Math.ceil(this.s().maxPlayers / this.s().teamCount));
  protected readonly myTeam = computed(() => this.game.me()?.team ?? null);

  protected categoryLabel(slug: string): string {
    const cat = CATEGORIES.find((c) => c.slug === slug)!;
    const lang = this.s().language;
    return lang === 'ta' ? cat.label.ta : lang === 'mixed' ? `${cat.label.en} · ${cat.label.ta}` : cat.label.en;
  }

  protected playersOf(team: number) {
    return this.state().players.filter((p) => p.team === team);
  }

  protected update(patch: Partial<RoomSettings>): void {
    void this.game.updateSettings(patch);
  }

  protected setNumber(key: NumericSetting, value: string): void {
    this.update({ [key]: Number(value) } as Partial<RoomSettings>);
  }

  protected setLanguage(value: string): void {
    this.update({ language: value as WordLanguage });
  }

  protected setDifficulty(value: string): void {
    this.update({ difficulty: value as DifficultySetting });
  }

  protected toggleCategory(slug: string): void {
    const current = this.s().categories;
    this.update({ categories: current.includes(slug) ? current.filter((c) => c !== slug) : [...current, slug] });
  }

  protected toggleChaosRule(rule: ChaosRule): void {
    const current = this.s().chaosRules;
    this.update({ chaosRules: current.includes(rule) ? current.filter((r) => r !== rule) : [...current, rule] });
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

type NumericSetting =
  | 'drawTime'
  | 'rounds'
  | 'maxPlayers'
  | 'artistCount'
  | 'artistSeconds'
  | 'votingSeconds'
  | 'voteBonus'
  | 'teamCount'
  | 'teamBonus';

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
