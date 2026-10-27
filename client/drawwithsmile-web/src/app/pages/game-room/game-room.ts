import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, untracked } from '@angular/core';
import {
  BRUSH_SIZES,
  CATEGORIES,
  CHAOS_RULES,
  REACTIONS,
  TIMINGS,
  VOTE_CATEGORIES,
  type ReactionEmoji,
  type RoomState,
  type VoteCandidate,
  type VoteCategory,
} from '@dws/shared';
import { DrawingService, NO_CONSTRAINTS } from '../../core/drawing/drawing.service';
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
  private readonly drawing = inject(DrawingService);

  readonly state = input.required<RoomState>();
  readonly leave = output<void>();
  protected readonly reactionList = REACTIONS;

  protected readonly canDraw = computed(() => this.game.canDraw());
  protected readonly drawerName = computed(() => this.game.drawer()?.nickname ?? 'Someone');
  protected readonly phaseTotal = computed(() => {
    const s = this.state();
    switch (s.phase) {
      case 'choosing':
        return TIMINGS.CHOOSE_WORD_MS / 1000;
      case 'turnEnd':
        return TIMINGS.TURN_END_MS / 1000;
      case 'voting':
        return s.voting?.closed ? TIMINGS.VOTE_REVEAL_MS / 1000 : s.settings.votingSeconds;
      default:
        return s.settings.drawTime;
    }
  });
  protected readonly choiceSeconds = computed(() => this.clock.secondsUntil(this.game.phaseDeadline()));
  protected readonly penSeconds = computed(() => this.clock.secondsUntil(this.game.penDeadline()));

  // ---------------------------------------------------------------- collaborative
  protected readonly collaborative = computed(() => this.state().phase === 'drawing' && this.state().artistIds.length > 1);
  protected readonly artists = computed(() => {
    const s = this.state();
    return s.artistIds.map((id) => s.players.find((p) => p.id === id)).filter((p) => !!p);
  });

  // ---------------------------------------------------------------- chaos
  protected readonly chaosRules = computed(() => {
    const chaos = this.state().chaos;
    return chaos ? CHAOS_RULES.filter((r) => chaos.rules.includes(r.id)) : [];
  });

  // ---------------------------------------------------------------- status texts
  protected readonly status = computed(() => {
    const s = this.state();
    const me = this.game.me();
    if (s.phase === 'choosing') return this.game.isDrawer() ? 'Pick a word to draw!' : `${this.drawerName()} is choosing a word…`;
    if (s.phase === 'turnEnd') return s.lastTurn?.word ? 'Time to reveal!' : 'Turn skipped';
    if (s.phase === 'voting') return s.voting?.closed ? 'And the winners are…' : 'Vote for your favourite drawings!';
    if (this.canDraw()) return 'Draw this word!';
    if (this.game.isArtist()) return `Wait for the pen… ${this.game.currentArtist()?.nickname ?? ''} is drawing`;
    if (me?.hasGuessed) return 'You got it! 🎉';
    return 'Guess the word!';
  });

  protected readonly chatPlaceholder = computed(() => {
    if (this.state().phase !== 'drawing') return 'Chat…';
    if (this.game.isArtist()) return 'Chat (no spoilers!)';
    return this.game.me()?.hasGuessed ? 'Chat with others who guessed…' : 'Type your guess here…';
  });

  protected readonly turnResults = computed(() => {
    const s = this.state();
    const deltas = s.lastTurn?.deltas ?? {};
    return s.players
      .map((p) => ({ player: p, delta: deltas[p.id] ?? 0, drew: s.lastTurn?.artistIds.includes(p.id) ?? false }))
      .sort((a, b) => b.delta - a.delta);
  });
  protected readonly turnReactions = computed(() => Object.entries(this.state().lastTurn?.reactions ?? {}));
  protected readonly turnTeamBonuses = computed(() => {
    const s = this.state();
    return Object.entries(s.lastTurn?.teamBonuses ?? {}).map(([team, bonus]) => ({ team: s.teams?.[Number(team)], bonus }));
  });

  // ---------------------------------------------------------------- reactions
  protected readonly showReactions = computed(() => {
    const s = this.state();
    // The drawer doesn't need to react to their own drawing (and on phones the space goes to the tools).
    return s.settings.reactions && (s.phase === 'drawing' || s.phase === 'turnEnd') && !this.canDraw();
  });

  // ---------------------------------------------------------------- voting
  protected readonly voteCategories = computed(() => {
    const ids = this.state().voting?.categories ?? [];
    return VOTE_CATEGORIES.filter((c) => ids.includes(c.id));
  });

  constructor() {
    // Apply this turn's chaos rules to the local pen (the server enforces them as well).
    effect(() => {
      const chaos = this.state().chaos;
      const mine = this.canDraw();
      untracked(() => {
        if (!chaos || !mine) {
          this.drawing.setConstraints(NO_CONSTRAINTS);
          return;
        }
        this.drawing.setConstraints({
          hideInk: chaos.rules.includes('invisible-ink'),
          flip: chaos.flip,
          palette: chaos.palette,
          lockSize: chaos.rules.includes('shifting-brush'),
          oneStroke: chaos.rules.includes('one-stroke'),
        });
      });
    });

    // Wobbly brush: change the size every few seconds.
    effect(() => {
      const seed = this.state().chaos?.brushSeed;
      if (seed == null || !this.canDraw()) return;
      const tick = Math.floor(this.clock.now() / TIMINGS.CHAOS_BRUSH_INTERVAL_MS);
      const size = BRUSH_SIZES[(seed + tick * 7) % BRUSH_SIZES.length]!;
      untracked(() => this.drawing.size.set(size));
    });

    // Keep a thumbnail of each finished drawing for the end-of-round vote.
    let captured = -1;
    effect(() => {
      const s = this.state();
      const turn = s.lastTurn?.turnNumber;
      if (s.phase !== 'turnEnd' || turn === undefined || turn === captured || !s.lastTurn?.word) return;
      captured = turn;
      untracked(() => {
        const picture = this.drawing.snapshot();
        if (picture) this.game.saveThumbnail(turn, picture);
      });
    });
  }

  protected react(emoji: ReactionEmoji): void {
    this.game.react(emoji);
  }

  protected nameOf(id: string): string {
    return this.state().players.find((p) => p.id === id)?.nickname ?? 'someone';
  }

  protected artistsOf(candidate: VoteCandidate): string {
    return candidate.artistIds.map((id) => this.nameOf(id)).join(' & ');
  }

  protected isMine(candidate: VoteCandidate): boolean {
    return candidate.artistIds.includes(this.game.playerId() ?? '');
  }

  protected votedFor(category: VoteCategory): number | undefined {
    return this.game.myVotes()[category];
  }

  protected wins(candidate: VoteCandidate): string[] {
    const winners = this.state().voting?.winners ?? [];
    return winners
      .filter((w) => w.turnNumber === candidate.turnNumber)
      .map((w) => VOTE_CATEGORIES.find((c) => c.id === w.category)!)
      .map((c) => `${c.icon} ${c.name}`);
  }

  protected categoryLabel(slug: string): string {
    const cat = CATEGORIES.find((c) => c.slug === slug);
    if (!cat) return slug;
    return this.state().settings.language === 'ta' ? cat.label.ta : cat.label.en;
  }
}
