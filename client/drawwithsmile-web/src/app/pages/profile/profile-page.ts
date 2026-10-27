import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACHIEVEMENTS, AVATAR_COUNT, TITLES, UNLOCKABLE_AVATARS, type PlayerProfile, type PlayerStats } from '@dws/shared';
import { ApiService } from '../../core/services/api.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { ToastService } from '../../core/services/toast.service';
import { Avatar } from '../../shared/components/avatar/avatar';

interface RewardView {
  unlocked: boolean;
  requirement: string;
}

/** Pick an unlocked avatar and title. Unlocks come from achievements checked by the server. */
@Component({
  selector: 'app-profile-page',
  imports: [RouterLink, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="container page">
      <a routerLink="/" class="btn btn-ghost btn-sm">← Home</a>
      <h1>🎨 Avatar & title</h1>
      @if (error()) {
        <p class="card">Couldn't load your profile. The server may be waking up — try again in a moment.</p>
      } @else if (profile(); as p) {
        @if (!p.persistent) {
          <p class="card small">Progress isn't being saved on this server right now, so only the free avatars are available.</p>
        }
        <section class="card preview">
          <app-avatar [index]="p.avatarId" [size]="88" />
          <div>
            <strong class="nick">{{ prefs.nickname() || 'You' }}</strong>
            <div class="title">{{ currentTitle() ?? 'No title' }}</div>
            <p class="small muted">Your look follows you into every room. Earn achievements to unlock more.</p>
          </div>
        </section>

        <section class="card">
          <h2>Avatars <span class="muted small">{{ p.unlockedAvatars.length }}/{{ avatars.length }} unlocked</span></h2>
          <div class="avatars">
            @for (a of avatars; track a.id) {
              @let r = reward(a.id);
              <button type="button" class="pick" [class.selected]="p.avatarId === a.id" [class.locked]="!r.unlocked"
                [disabled]="!r.unlocked || saving()" (click)="save({ avatarId: a.id })"
                [attr.aria-label]="(r.unlocked ? 'Use avatar ' : 'Locked avatar ') + a.name" [title]="r.unlocked ? a.name : a.name + ' — ' + r.requirement">
                <app-avatar [index]="a.id" [size]="52" />
                @if (!r.unlocked) { <span class="lock">🔒</span> }
                @if (a.special) { <span class="label">{{ a.name }}</span> }
              </button>
            }
          </div>
        </section>

        <section class="card">
          <h2>Titles</h2>
          <div class="titles">
            <button type="button" class="chip pickable" [class.selected]="p.titleId === null" [disabled]="saving()" (click)="save({ titleId: null })">No title</button>
            @for (t of titles; track t.id) {
              @let r = titleReward(t.id);
              <button type="button" class="chip pickable" [class.selected]="p.titleId === t.id" [class.locked]="!r.unlocked"
                [disabled]="!r.unlocked || saving()" (click)="save({ titleId: t.id })" [title]="r.requirement">
                {{ r.unlocked ? '🏅' : '🔒' }} {{ t.name }}
              </button>
            }
          </div>
        </section>

        <section class="card">
          <h2>How to unlock</h2>
          <ul class="achievements">
            @for (a of achievements; track a.code) {
              <li [class.earned]="earned().has(a.code)">
                <span class="icon">{{ earned().has(a.code) ? '⭐' : '🔒' }}</span>
                <span><strong>{{ a.name }}</strong> — <span class="small">{{ a.description }}</span>
                  @if (progress(a.code); as pr) { <span class="small muted"> ({{ pr }})</span> }
                </span>
              </li>
            }
          </ul>
          <p class="small muted">Progress belongs to this browser's guest identity — no account or personal data needed.</p>
        </section>
      } @else {
        <p class="muted">Loading…</p>
      }
    </div>
  `,
  styles: `
    .page { display: flex; flex-direction: column; gap: 12px; max-width: 820px; }
    .preview { display: flex; align-items: center; gap: 16px; }
    .nick { font-size: 1.3rem; }
    .title { font-weight: 700; color: var(--grape); }
    .avatars { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
    .pick {
      position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px;
      border: 2px solid transparent; border-radius: 14px; background: #f7f3ec; cursor: pointer;
    }
    .pick.selected { border-color: var(--ink); background: var(--sun); }
    .pick.locked { filter: grayscale(0.9); opacity: 0.55; cursor: not-allowed; }
    .lock { position: absolute; top: 2px; right: 6px; }
    .label { font-size: 0.7rem; font-weight: 700; }
    .titles { display: flex; flex-wrap: wrap; gap: 8px; }
    .pickable { cursor: pointer; min-height: 36px; }
    .pickable.selected { background: var(--sun); }
    .pickable.locked { opacity: 0.5; cursor: not-allowed; }
    .achievements { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .achievements li { display: flex; gap: 8px; opacity: 0.7; }
    .achievements li.earned { opacity: 1; }
  `,
})
export class ProfilePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly prefs = inject(PreferencesService);

  protected readonly avatars = [
    ...Array.from({ length: AVATAR_COUNT }, (_, id) => ({ id, name: `Smiley ${id + 1}`, special: false })),
    ...UNLOCKABLE_AVATARS.map((a) => ({ id: a.id, name: a.name, special: true })),
  ];
  protected readonly titles = TITLES;
  protected readonly achievements = ACHIEVEMENTS;
  protected readonly profile = signal<PlayerProfile | null>(null);
  protected readonly stats = signal<PlayerStats | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal(false);

  protected readonly earned = computed(() => new Set(this.stats()?.achievements.filter((a) => a.earnedAt).map((a) => a.code) ?? []));
  protected readonly currentTitle = computed(() => TITLES.find((t) => t.id === this.profile()?.titleId)?.name ?? null);

  async ngOnInit(): Promise<void> {
    try {
      const [profile, stats] = await Promise.all([this.api.profile(), this.api.myStats()]);
      this.profile.set(profile);
      this.stats.set(stats.stats);
    } catch {
      this.error.set(true);
    }
  }

  protected reward(avatarId: number): RewardView {
    const unlocked = this.profile()?.unlockedAvatars.includes(avatarId) ?? false;
    const code = UNLOCKABLE_AVATARS.find((a) => a.id === avatarId)?.unlock;
    return { unlocked, requirement: code ? requirement(code) : '' };
  }

  protected titleReward(titleId: string): RewardView {
    const unlocked = this.profile()?.unlockedTitles.includes(titleId) ?? false;
    const code = TITLES.find((t) => t.id === titleId)?.unlock;
    return { unlocked, requirement: code ? requirement(code) : '' };
  }

  /** Shows "3/10" style progress for count-based achievements. */
  protected progress(code: string): string | null {
    const s = this.stats();
    if (!s || this.earned().has(code)) return null;
    const goals: Record<string, [number, number]> = {
      SHARP_EYE: [s.correctGuesses, 50],
      ARTIST: [s.drawings, 25],
      VETERAN: [s.gamesPlayed, 25],
      QUICK_GUESSER: [s.quickGuesses, 10],
      MASTER_DOODLER: [s.perfectDrawings, 10],
      CHAOS_SURVIVOR: [s.chaosTurns, 5],
      TEAM_PLAYER: [s.collabDrawings, 3],
      CREATIVE_LEGEND: [s.votesReceived, 10],
    };
    const goal = goals[code];
    return goal ? `${Math.min(goal[0], goal[1])}/${goal[1]}` : null;
  }

  protected async save(change: { avatarId?: number; titleId?: string | null }): Promise<void> {
    this.saving.set(true);
    try {
      this.profile.set(await this.api.saveProfile({ ...change, nickname: this.prefs.nickname() || undefined }));
      this.toast.show('Saved!', 'success');
    } catch (err) {
      this.toast.error(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      this.saving.set(false);
    }
  }
}

function requirement(code: string): string {
  const a = ACHIEVEMENTS.find((x) => x.code === code);
  return a ? `Unlock: ${a.name} — ${a.description}` : '';
}
