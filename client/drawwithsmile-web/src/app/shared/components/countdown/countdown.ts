import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { ClockService } from '../../../core/services/clock.service';
import { SoundService } from '../../../core/services/sound.service';

/** Circular countdown to a local deadline. */
@Component({
  selector: 'app-countdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (seconds() !== null) {
      <div class="timer" [class.urgent]="urgent()" role="timer" [attr.aria-label]="seconds() + ' seconds left'">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="19" class="track" />
          <circle cx="22" cy="22" r="19" class="bar" [attr.stroke-dasharray]="119.4" [attr.stroke-dashoffset]="offset()" />
        </svg>
        <span>{{ seconds() }}</span>
      </div>
    }
  `,
  styles: `
    .timer { position: relative; width: 48px; height: 48px; display: grid; place-items: center; font-weight: 800; }
    svg { position: absolute; inset: 0; transform: rotate(-90deg); }
    circle { fill: #fff; stroke-width: 4; }
    .track { stroke: var(--line); }
    .bar { fill: none; stroke: var(--teal); stroke-linecap: round; transition: stroke-dashoffset 0.25s linear; }
    .urgent .bar { stroke: var(--coral); }
    .urgent span { color: var(--coral); }
    span { position: relative; font-size: 1.05rem; }
  `,
})
export class Countdown {
  private readonly clock = inject(ClockService);
  private readonly sound = inject(SoundService);
  readonly deadline = input<number | null>(null);
  readonly total = input(60);
  readonly tick = input(false);

  protected readonly seconds = computed(() => this.clock.secondsUntil(this.deadline()));
  protected readonly urgent = computed(() => (this.seconds() ?? 99) <= 10);
  protected readonly offset = computed(() => {
    const ratio = Math.min(1, Math.max(0, (this.seconds() ?? 0) / Math.max(1, this.total())));
    return 119.4 * (1 - ratio);
  });

  private lastTicked: number | null = null;

  constructor() {
    effect(() => {
      const s = this.seconds();
      if (this.tick() && s !== null && s > 0 && s <= 5 && s !== this.lastTicked) {
        this.lastTicked = s;
        this.sound.play('tick');
      }
    });
  }
}
