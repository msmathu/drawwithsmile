import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LIMITS, isValidNickname, isValidRoomCode, normalizeRoomCode, sanitizeNickname } from '@dws/shared';
import { GameService } from '../../core/services/game.service';
import { PreferencesService, randomNickname } from '../../core/services/preferences.service';
import { GameRoom } from '../game-room/game-room';
import { Lobby } from '../lobby/lobby';
import { Results } from '../results/results';

/** /room/:code — joins the room if needed, then shows lobby, game or results. */
@Component({
  selector: 'app-room-page',
  imports: [Lobby, GameRoom, Results, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let state = game.state();
    @if (state && state.code === roomCode()) {
      @switch (state.phase) {
        @case ('lobby') { <app-lobby [state]="state" (leave)="leave()" /> }
        @case ('gameEnd') { <app-results [state]="state" (leave)="leave()" /> }
        @default { <app-game-room [state]="state" (leave)="leave()" /> }
      }
    } @else {
      <div class="container center">
        <div class="card stack box">
          @switch (status()) {
            @case ('joining') { <h2>Joining room {{ roomCode() }}…</h2> }
            @case ('invalid') {
              <h2>That link doesn't look right</h2>
              <p class="muted">Room codes have 8 letters and numbers.</p>
              <a routerLink="/" class="btn btn-primary">Back home</a>
            }
            @case ('error') {
              <h2>Couldn't join</h2>
              <p class="muted">The room may be full, already playing, or closed.</p>
              <div class="row">
                <button type="button" class="btn btn-primary" (click)="join()">Try again</button>
                <a routerLink="/" class="btn">Back home</a>
              </div>
            }
            @case ('nickname') {
              <h2>Join room {{ roomCode() }}</h2>
              <form class="stack" (submit)="$event.preventDefault(); join()">
                <label class="field" for="room-nick">Choose a nickname
                  <input id="room-nick" class="input" [attr.maxlength]="maxNickname * 2" [value]="nickname()"
                    (input)="nickname.set($any($event.target).value)" />
                </label>
                <button type="submit" class="btn btn-primary" [disabled]="!nicknameValid()">Join game</button>
              </form>
            }
          }
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .center { display: grid; place-items: center; flex: 1; }
    .box { max-width: 420px; width: 100%; text-align: center; }
  `,
})
export class RoomPage {
  protected readonly game = inject(GameService);
  private readonly prefs = inject(PreferencesService);
  private readonly router = inject(Router);

  /** Route parameter (bound via withComponentInputBinding). */
  readonly code = input.required<string>();
  protected readonly roomCode = computed(() => normalizeRoomCode(this.code()));
  protected readonly status = signal<'joining' | 'nickname' | 'error' | 'invalid'>('joining');
  protected readonly nickname = signal(this.prefs.nickname() || randomNickname());
  protected readonly maxNickname = LIMITS.NICKNAME_MAX;
  protected readonly nicknameValid = computed(() => isValidNickname(sanitizeNickname(this.nickname())));

  constructor() {
    effect(() => {
      const code = this.roomCode();
      untracked(() => {
        if (this.game.state()?.code === code) return;
        if (!isValidRoomCode(code)) this.status.set('invalid');
        else if (isValidNickname(sanitizeNickname(this.prefs.nickname()))) void this.join();
        else this.status.set('nickname');
      });
    });
  }

  protected async join(): Promise<void> {
    if (!this.nicknameValid()) {
      this.status.set('nickname');
      return;
    }
    this.status.set('joining');
    const code = await this.game.joinRoom(this.roomCode(), sanitizeNickname(this.nickname()));
    if (!code) this.status.set('error');
  }

  protected async leave(): Promise<void> {
    await this.game.leave();
    await this.router.navigateByUrl('/');
  }
}
