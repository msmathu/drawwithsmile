import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { RoomState } from '@dws/shared';
import { ClockService } from '../../core/services/clock.service';
import { GameService } from '../../core/services/game.service';
import { Avatar } from '../../shared/components/avatar/avatar';

/** Final leaderboard for a finished game. */
@Component({
  selector: 'app-results',
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = state();
    <div class="container results">
      <h1>🎉 Game over!</h1>
      <div class="podium" aria-label="Top players">
        @for (p of podium(); track p.playerId) {
          <div class="place" [class]="'place p' + p.rank">
            <app-avatar [index]="p.avatar" [size]="p.rank === 1 ? 72 : 56" />
            <strong class="nick">{{ p.nickname }}</strong>
            <span class="pts">{{ p.score }} pts</span>
            <div class="block">{{ medal(p.rank) }}</div>
          </div>
        }
      </div>

      <ol class="card table">
        @for (p of s.standings ?? []; track p.playerId) {
          <li [class.me]="p.playerId === game.playerId()">
            <span class="rank">#{{ p.rank }}</span>
            <app-avatar [index]="p.avatar" [size]="30" />
            <span class="nick">{{ p.nickname }}</span>
            <strong>{{ p.score }}</strong>
          </li>
        }
      </ol>

      <p class="muted">Back to the lobby in {{ seconds() }}s…</p>
      <div class="row center">
        @if (game.isHost()) {
          <button type="button" class="btn btn-primary btn-lg" (click)="game.backToLobby()">🔁 Play again</button>
        }
        <button type="button" class="btn" (click)="leave.emit()">Leave room</button>
      </div>
    </div>
  `,
  styles: `
    .results { display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
    h1 { margin: 8px 0 0; }
    .podium { display: flex; align-items: flex-end; justify-content: center; gap: 12px; margin-top: 8px; }
    .place { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 104px; }
    .p1 { order: 2; } .p2 { order: 1; } .p3 { order: 3; }
    .nick { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pts { font-size: 0.9rem; font-weight: 700; color: var(--ink-soft); }
    .block {
      width: 100%; display: grid; place-items: center; font-size: 1.6rem; border: 2px solid var(--ink);
      border-radius: 12px 12px 0 0; box-shadow: var(--shadow-sm);
    }
    .p1 .block { height: 96px; background: var(--sun); }
    .p2 .block { height: 70px; background: #dfe6f1; }
    .p3 .block { height: 52px; background: #f3c99a; }
    .table { list-style: none; margin: 0; width: 100%; max-width: 440px; padding: 10px; display: flex; flex-direction: column; gap: 4px; }
    .table li { display: flex; align-items: center; gap: 10px; padding: 4px 8px; border-radius: 10px; }
    .table li.me { background: #fff7dc; }
    .rank { width: 32px; font-weight: 800; }
    .table .nick { flex: 1; text-align: left; font-weight: 600; }
    .center { justify-content: center; }
  `,
})
export class Results {
  protected readonly game = inject(GameService);
  private readonly clock = inject(ClockService);
  readonly state = input.required<RoomState>();
  readonly leave = output<void>();

  protected readonly podium = computed(() => (this.state().standings ?? []).filter((p) => p.rank <= 3).slice(0, 3));
  protected readonly seconds = computed(() => this.clock.secondsUntil(this.game.phaseDeadline()) ?? 0);

  protected medal(rank: number): string {
    return ['🥇', '🥈', '🥉'][rank - 1] ?? '';
  }
}
