import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CATEGORIES, TIMINGS, type RoomState } from '@dws/shared';
import { ClockService } from '../../core/services/clock.service';
import { GameService } from '../../core/services/game.service';
import { Avatar } from '../../shared/components/avatar/avatar';
import { CanvasBoard } from '../../shared/components/canvas-board/canvas-board';
import { ChatPanel } from '../../shared/components/chat-panel/chat-panel';
import { Countdown } from '../../shared/components/countdown/countdown';
import { DrawingToolbar } from '../../shared/components/drawing-toolbar/drawing-toolbar';
import { PlayerList } from '../../shared/components/player-list/player-list';
import { WordHint } from '../../shared/components/word-hint/word-hint';

@Component({
  selector: 'app-game-room',
  imports: [CanvasBoard, DrawingToolbar, ChatPanel, PlayerList, WordHint, Countdown, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-room.html',
  styleUrl: './game-room.css',
})
export class GameRoom {
  protected readonly game = inject(GameService);
  private readonly clock = inject(ClockService);

  readonly state = input.required<RoomState>();
  readonly leave = output<void>();
  protected readonly showPlayers = signal(false);

  protected readonly canDraw = computed(() => this.game.isDrawer() && this.state().phase === 'drawing');
  protected readonly drawerName = computed(() => this.game.drawer()?.nickname ?? 'Someone');
  protected readonly phaseTotal = computed(() => {
    switch (this.state().phase) {
      case 'choosing':
        return TIMINGS.CHOOSE_WORD_MS / 1000;
      case 'turnEnd':
        return TIMINGS.TURN_END_MS / 1000;
      default:
        return this.state().settings.drawTime;
    }
  });
  protected readonly choiceSeconds = computed(() => this.clock.secondsUntil(this.game.phaseDeadline()));

  protected readonly status = computed(() => {
    const s = this.state();
    const me = this.game.me();
    if (s.phase === 'choosing') return this.game.isDrawer() ? 'Pick a word to draw!' : `${this.drawerName()} is choosing a word…`;
    if (s.phase === 'turnEnd') return s.lastTurn?.word ? 'Time to reveal!' : 'Turn skipped';
    if (this.game.isDrawer()) return 'Draw this word!';
    if (me?.hasGuessed) return 'You got it! 🎉';
    return 'Guess the word!';
  });

  protected readonly chatPlaceholder = computed(() => {
    if (this.state().phase !== 'drawing') return 'Chat…';
    if (this.game.isDrawer()) return 'Chat (no spoilers!)';
    return this.game.me()?.hasGuessed ? 'Chat with others who guessed…' : 'Type your guess here…';
  });

  protected readonly turnResults = computed(() => {
    const s = this.state();
    const deltas = s.lastTurn?.deltas ?? {};
    return s.players
      .map((p) => ({ player: p, delta: deltas[p.id] ?? 0, drew: p.id === s.lastTurn?.drawerId }))
      .sort((a, b) => b.delta - a.delta);
  });

  protected categoryLabel(slug: string): string {
    const cat = CATEGORIES.find((c) => c.slug === slug);
    return cat ? cat.label[this.state().settings.language] : slug;
  }
}
