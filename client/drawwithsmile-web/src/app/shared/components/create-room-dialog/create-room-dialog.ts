import { ChangeDetectionStrategy, Component, type OnInit, computed, input, output, signal } from '@angular/core';
import {
  LANGUAGES,
  LIMITS,
  MAX_PLAYER_OPTIONS,
  isValidRoomName,
  sanitizeRoomName,
  type CreateRoomPayload,
  type Language,
  type RoomVisibility,
} from '@dws/shared';
import { Modal } from '../modal/modal';

export type CreateRoomOptions = Omit<CreateRoomPayload, 'nickname'>;

/** "Create Room" dialog: room type, random or custom name, max players slider. */
@Component({
  selector: 'app-create-room-dialog',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal heading="＋ Create Room" (closed)="closed.emit()">
      <form class="stack" (submit)="submit($event)">
        <label class="field">Room type
          <select class="input" (change)="visibility.set($any($event.target).value)">
            <option value="public" [selected]="visibility() === 'public'">Public — anyone can join</option>
            <option value="private" [selected]="visibility() === 'private'">Private — friends with the name or code</option>
          </select>
        </label>

        <label class="check">
          <span>Random room name</span>
          <input type="checkbox" [checked]="randomName()" (change)="randomName.set($any($event.target).checked)" />
        </label>
        @if (!randomName()) {
          <label class="field">Room name
            <input class="input" [attr.maxlength]="maxName * 2" placeholder="e.g. Friday Doodlers" [value]="name()"
              (input)="name.set($any($event.target).value)" [attr.aria-invalid]="touched() && !nameValid()" />
            <small class="small" [class.error]="touched() && !nameValid()">{{ minName }}–{{ maxName }} letters, numbers or spaces.</small>
          </label>
        }

        @if (visibility() === 'private') {
          <label class="check">
            <span>Show in the private room list <small class="muted">(off = code/link only)</small></span>
            <input type="checkbox" [checked]="listed()" (change)="listed.set($any($event.target).checked)" />
          </label>
        }

        <div class="field">
          <span>Max players: <strong>{{ maxPlayers() }}</strong></span>
          <input type="range" class="slider" [min]="sliderMin" [max]="sliderMax" step="2" [value]="maxPlayers()"
            (input)="maxPlayers.set(+$any($event.target).value)" aria-label="Max players" />
          <div class="ticks" aria-hidden="true">
            @for (n of playerOptions; track n) {
              <button type="button" [class.on]="n === maxPlayers()" (click)="maxPlayers.set(n)" tabindex="-1">{{ n }}</button>
            }
          </div>
        </div>

        <label class="field">Word language
          <select class="input" (change)="language.set($any($event.target).value)">
            @for (l of languages; track l.code) {
              <option [value]="l.code" [selected]="l.code === language()">{{ l.label }}</option>
            }
          </select>
        </label>

        <button type="submit" class="btn btn-secondary btn-lg btn-block" [disabled]="busy()">
          {{ busy() ? 'Creating…' : 'Start Playing!' }}
        </button>
      </form>
    </app-modal>
  `,
  styles: `
    .check { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-weight: 600; }
    .check input { width: 22px; height: 22px; accent-color: var(--teal); }
    .slider { width: 100%; accent-color: var(--coral); height: 28px; }
    .ticks { display: flex; justify-content: space-between; }
    .ticks button { border: 0; background: none; font-weight: 800; color: var(--ink-soft); cursor: pointer; padding: 2px 4px; }
    .ticks button.on { color: var(--coral); }
    .error { color: var(--danger); font-weight: 700; }
  `,
})
export class CreateRoomDialog implements OnInit {
  readonly defaultLanguage = input<Language>('en');
  readonly busy = input(false);
  readonly closed = output<void>();
  readonly create = output<CreateRoomOptions>();

  protected readonly languages = LANGUAGES;
  protected readonly playerOptions = MAX_PLAYER_OPTIONS;
  protected readonly sliderMin = MAX_PLAYER_OPTIONS[0];
  protected readonly sliderMax = MAX_PLAYER_OPTIONS[MAX_PLAYER_OPTIONS.length - 1];
  protected readonly minName = LIMITS.ROOM_NAME_MIN;
  protected readonly maxName = LIMITS.ROOM_NAME_MAX;

  protected readonly visibility = signal<RoomVisibility>('public');
  protected readonly randomName = signal(true);
  protected readonly name = signal('');
  protected readonly listed = signal(true);
  protected readonly maxPlayers = signal(8);
  protected readonly language = signal<Language>('en');
  protected readonly touched = signal(false);
  protected readonly nameValid = computed(() => isValidRoomName(sanitizeRoomName(this.name())));

  ngOnInit(): void {
    this.language.set(this.defaultLanguage());
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.touched.set(true);
    if (!this.randomName() && !this.nameValid()) return;
    this.create.emit({
      visibility: this.visibility(),
      name: this.randomName() ? undefined : sanitizeRoomName(this.name()),
      listed: this.visibility() === 'private' ? this.listed() : true,
      settings: { maxPlayers: this.maxPlayers(), language: this.language() },
    });
  }
}
