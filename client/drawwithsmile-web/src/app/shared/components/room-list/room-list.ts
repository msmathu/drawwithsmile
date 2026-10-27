import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { RoomListing } from '@dws/shared';

/** Human-readable room status, e.g. "Playing round 2 of 3". */
export function roomStatus(room: RoomListing): string {
  switch (room.phase) {
    case 'lobby':
      return 'Waiting for players';
    case 'gameEnd':
      return 'Finishing game';
    default:
      return `Playing round ${Math.max(1, room.round)} of ${room.totalRounds}`;
  }
}

/** Clickable list of rooms for the room browser. */
@Component({
  selector: 'app-room-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="rooms">
      @for (room of rooms(); track room.code) {
        <li class="room" [class.full]="room.players >= room.maxPlayers">
          <button type="button" class="join" [disabled]="room.players >= room.maxPlayers || disabled()"
            (click)="pick.emit(room)" [attr.aria-label]="'Join ' + room.name + ', ' + status(room)">
            <span class="info">
              <span class="name">{{ room.name }}</span>
              <span class="status">
                {{ status(room) }}
                @if (room.language === 'ta') { <span class="lang">தமிழ்</span> } @else if (room.language === 'mixed') { <span class="lang">EN + தமிழ்</span> }
              </span>
            </span>
            <span class="count" title="Players">👤<br />{{ room.players }}/{{ room.maxPlayers }}</span>
          </button>
          @if (reportable()) {
            <button type="button" class="flag" title="Report this room name" [attr.aria-label]="'Report room name ' + room.name"
              (click)="report.emit(room)">⚑</button>
          }
        </li>
      } @empty {
        <li class="empty">{{ emptyText() }}</li>
      }
    </ul>
  `,
  styles: `
    .rooms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .room { display: flex; align-items: stretch; border-bottom: 2px solid rgba(31, 37, 68, 0.12); }
    .room:last-child { border-bottom: 0; }
    .join {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; background: none;
      text-align: left; cursor: pointer; transition: background 0.12s;
    }
    .join:hover:not(:disabled) { background: #fff3cf; }
    .join:disabled { cursor: not-allowed; opacity: 0.55; }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .name { font-size: 1.2rem; font-weight: 800; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status { font-size: 0.85rem; color: var(--ink-soft); font-weight: 600; }
    .lang { margin-left: 6px; padding: 0 6px; border-radius: 6px; background: #e3eeff; color: var(--ink); }
    .count { text-align: center; font-size: 0.75rem; font-weight: 800; line-height: 1.1; min-width: 42px; }
    .flag { width: 40px; border: 0; background: none; cursor: pointer; color: var(--ink-soft); font-size: 1rem; }
    .flag:hover { color: var(--danger); }
    .empty { padding: 14px; color: var(--ink-soft); text-align: center; }
  `,
})
export class RoomList {
  readonly rooms = input.required<RoomListing[]>();
  readonly emptyText = input('No rooms yet.');
  readonly reportable = input(false);
  readonly disabled = input(false);
  readonly pick = output<RoomListing>();
  readonly report = output<RoomListing>();

  protected status(room: RoomListing): string {
    return roomStatus(room);
  }
}
