import { ChangeDetectionStrategy, Component, type OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { LeaderboardEntry, PlayerStats } from '@dws/shared';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-leaderboard-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container page">
      <a routerLink="/" class="btn btn-ghost btn-sm">← Home</a>
      <h1>🏆 Leaderboard</h1>
      @if (error()) {
        <p class="card">Couldn't load the leaderboard right now. The server may be waking up — try again in a moment.</p>
      }
      @if (!persistent()) {
        <p class="card small">Scores are not being saved on this server right now, so the leaderboard is empty.</p>
      }

      <div class="grid">
        <section class="card">
          <h2>Top players</h2>
          @if (entries().length) {
            <table>
              <thead><tr><th>#</th><th>Player</th><th>Points</th><th>Wins</th><th>Games</th></tr></thead>
              <tbody>
                @for (e of entries(); track e.rank) {
                  <tr><td>{{ e.rank }}</td><td class="nick">{{ e.nickname }}</td><td>{{ e.totalScore }}</td><td>{{ e.wins }}</td><td>{{ e.gamesPlayed }}</td></tr>
                }
              </tbody>
            </table>
          } @else if (!loading()) {
            <p class="muted">No finished games yet. Be the first!</p>
          }
        </section>

        <section class="card">
          <h2>Your progress</h2>
          @if (stats(); as s) {
            <dl class="stats">
              <div><dt>Games</dt><dd>{{ s.gamesPlayed }}</dd></div>
              <div><dt>Wins</dt><dd>{{ s.wins }}</dd></div>
              <div><dt>Total points</dt><dd>{{ s.totalScore }}</dd></div>
              <div><dt>Best game</dt><dd>{{ s.bestScore }}</dd></div>
              <div><dt>Words guessed</dt><dd>{{ s.correctGuesses }}</dd></div>
              <div><dt>Drawings</dt><dd>{{ s.drawings }}</dd></div>
            </dl>
            <h3>Achievements</h3>
            <ul class="achievements">
              @for (a of s.achievements; track a.code) {
                <li [class.earned]="a.earnedAt">
                  <span class="icon">{{ a.earnedAt ? '⭐' : '🔒' }}</span>
                  <span><strong>{{ a.name }}</strong><br /><span class="small muted">{{ a.description }}</span></span>
                </li>
              }
            </ul>
            <p class="small muted">Progress is tied to this browser's guest identity. No account or personal data needed.</p>
          } @else if (!loading()) {
            <p class="muted">Play a game to start tracking your progress.</p>
          }
        </section>
      </div>
    </div>
  `,
  styles: `
    .page { display: flex; flex-direction: column; gap: 12px; }
    .grid { display: grid; gap: 16px; }
    @media (min-width: 860px) { .grid { grid-template-columns: 3fr 2fr; align-items: start; } }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); }
    .nick { font-weight: 700; overflow-wrap: anywhere; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 0 0 12px; }
    .stats div { background: #fff7dc; border-radius: 12px; padding: 8px; text-align: center; }
    .stats dt { font-size: 0.8rem; color: var(--ink-soft); }
    .stats dd { margin: 0; font-size: 1.4rem; font-weight: 800; }
    .achievements { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .achievements li { display: flex; gap: 10px; align-items: center; opacity: 0.55; }
    .achievements li.earned { opacity: 1; }
    .icon { font-size: 1.4rem; }
  `,
})
export class LeaderboardPage implements OnInit {
  private readonly api = inject(ApiService);
  protected readonly entries = signal<LeaderboardEntry[]>([]);
  protected readonly stats = signal<PlayerStats | null>(null);
  protected readonly persistent = signal(true);
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const [board, mine] = await Promise.all([this.api.leaderboard(), this.api.myStats()]);
      this.entries.set(board.entries);
      this.persistent.set(board.persistent);
      this.stats.set(mine.stats && mine.stats.gamesPlayed > 0 ? mine.stats : null);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }
}
