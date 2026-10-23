import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { REPORT_REASONS, type PlayerPublic, type ReportReason } from '@dws/shared';
import { GameService } from '../../../core/services/game.service';
import { Avatar } from '../avatar/avatar';

type PlayerReportReason = Exclude<ReportReason, 'inappropriate-room-name'>;

const REASON_LABELS: Record<PlayerReportReason, string> = {
  spam: 'Spam',
  offensive: 'Offensive language',
  cheating: 'Cheating',
  'inappropriate-drawing': 'Inappropriate drawing',
  other: 'Other',
};

/** Players with scores, status badges and moderation actions. */
@Component({
  selector: 'app-player-list',
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="players" [class.compact]="compact()">
      @for (p of sorted(); track p.id) {
        <li class="player" [class.me]="p.id === game.playerId()" [class.offline]="!p.connected"
          [class.drawing]="p.isDrawer" [class.guessed]="p.hasGuessed">
          <button type="button" class="who" [disabled]="p.id === game.playerId()" (click)="toggle(p.id)"
            [attr.aria-expanded]="openId() === p.id" [attr.aria-label]="'Options for ' + p.nickname">
            <app-avatar [index]="p.avatar" [size]="compact() ? 30 : 36" />
            <span class="name">
              <span class="nick">{{ p.nickname }}@if (p.id === game.playerId()) { <span class="muted"> (you)</span> }</span>
              <span class="tags">
                @if (p.isHost) { <span title="Host">👑</span> }
                @if (p.isDrawer) { <span title="Drawing">✏️</span> }
                @if (p.hasGuessed) { <span title="Guessed it">✅</span> }
                @if (p.muted || game.locallyMuted().has(p.id)) { <span title="Muted">🔇</span> }
                @if (!p.connected) { <span class="small muted">offline</span> }
                @if (votes(p.id)) { <span class="small muted">kick {{ votes(p.id) }}/{{ game.state()?.votesNeeded }}</span> }
              </span>
            </span>
            @if (showScores()) { <span class="score">{{ p.score }}</span> }
          </button>
          @if (openId() === p.id) {
            <div class="menu">
              <button type="button" class="btn btn-sm" (click)="game.toggleLocalMute(p.id); close()">
                {{ game.locallyMuted().has(p.id) ? 'Unmute for me' : 'Mute for me' }}
              </button>
              @if (isPrivateHost()) {
                <button type="button" class="btn btn-sm" (click)="game.setMuted(p.id, !p.muted); close()">
                  {{ p.muted ? 'Unmute in room' : 'Mute in room' }}
                </button>
                <button type="button" class="btn btn-sm" (click)="game.kick(p.id, false); close()">Kick</button>
                <button type="button" class="btn btn-sm btn-danger" (click)="game.kick(p.id, true); close()">Ban</button>
              }
              @if (isPublic()) {
                <button type="button" class="btn btn-sm" (click)="game.voteKick(p.id); close()">Vote to kick</button>
              }
              @if (reporting()) {
                <div class="reasons">
                  @for (r of reasons; track r) {
                    <button type="button" class="btn btn-sm" (click)="game.report(p.id, r); close()">{{ label(r) }}</button>
                  }
                </div>
              } @else {
                <button type="button" class="btn btn-sm" (click)="reporting.set(true)">Report…</button>
              }
            </div>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    .players { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .player { background: #fff; border: 2px solid var(--ink); border-radius: 14px; box-shadow: var(--shadow-sm); }
    .player.me { background: #fff7dc; }
    .player.drawing { background: #e3eeff; }
    .player.guessed { background: #dcf8ea; }
    .player.offline { opacity: 0.55; }
    .who {
      width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: none; border: 0;
      text-align: left; cursor: pointer; border-radius: 12px;
    }
    .who:disabled { cursor: default; }
    .name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .nick { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tags { display: flex; gap: 4px; align-items: center; font-size: 0.85rem; min-height: 1em; }
    .score { font-weight: 800; font-size: 1.1rem; }
    .menu, .reasons { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 10px; }
    .reasons { padding: 0; }
    .compact .who { padding: 4px 8px; }
  `,
})
export class PlayerList {
  protected readonly game = inject(GameService);
  readonly players = input.required<PlayerPublic[]>();
  readonly showScores = input(true);
  readonly sortByScore = input(false);
  readonly compact = input(false);

  protected readonly reasons = REPORT_REASONS.filter((r): r is PlayerReportReason => r !== 'inappropriate-room-name');
  protected readonly openId = signal<string | null>(null);
  protected readonly reporting = signal(false);

  protected readonly sorted = computed(() =>
    this.sortByScore() ? [...this.players()].sort((a, b) => b.score - a.score) : this.players(),
  );
  protected readonly isPublic = computed(() => this.game.state()?.visibility === 'public');
  protected readonly isPrivateHost = computed(() => !this.isPublic() && this.game.isHost());

  protected votes(id: string): number {
    return this.game.state()?.voteKicks[id] ?? 0;
  }

  protected label(reason: PlayerReportReason): string {
    return REASON_LABELS[reason];
  }

  protected toggle(id: string): void {
    this.reporting.set(false);
    this.openId.update((current) => (current === id ? null : id));
  }

  protected close(): void {
    this.openId.set(null);
    this.reporting.set(false);
  }
}
