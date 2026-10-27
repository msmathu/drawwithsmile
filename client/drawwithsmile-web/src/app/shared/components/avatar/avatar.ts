import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AVATAR_COUNT } from '@dws/shared';

const COLORS = ['#ffc83d', '#ff6b6b', '#1fb5a8', '#4d96ff', '#8e6cef', '#ff9f43', '#6ad08b', '#f78fb3', '#54c7ec', '#c8a2ff', '#ffd166', '#9be564'];
const MOUTHS = [
  'M12 22 Q20 30 28 22', // smile
  'M12 22 Q20 32 28 22 Z', // open grin
  'M13 24 Q20 27 27 24', // calm
  'M12 22 Q20 30 28 22 M18 26 Q20 31 22 26', // tongue
];

type Accessory = 'party' | 'shades' | 'bolt' | 'beret' | 'crown' | 'captain' | 'wild' | 'stars' | 'phones' | 'wizard';

/** Unlockable avatars (ids AVATAR_COUNT…): a face colour plus an accessory. */
const UNLOCKABLE: Record<number, { color: string; accessory: Accessory }> = {
  12: { color: '#ffd166', accessory: 'party' },
  13: { color: '#54c7ec', accessory: 'shades' },
  14: { color: '#ffc83d', accessory: 'bolt' },
  15: { color: '#f78fb3', accessory: 'beret' },
  16: { color: '#c8a2ff', accessory: 'crown' },
  17: { color: '#6ad08b', accessory: 'captain' },
  18: { color: '#ff9f43', accessory: 'wild' },
  19: { color: '#ff6b6b', accessory: 'stars' },
  20: { color: '#1fb5a8', accessory: 'phones' },
  21: { color: '#4d96ff', accessory: 'wizard' },
};

/** Smiley avatar from an index — original SVG art, no image files. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="-3 -7 46 47" aria-hidden="true">
      @if (accessory() === 'wild') {
        <path d="M6 14 L4 2 L12 9 L14 -2 L20 7 L26 -2 L28 9 L36 2 L34 14 Z" fill="#7a3e00" stroke="#1f2544" stroke-width="1.8" stroke-linejoin="round" />
      }
      @if (accessory() === 'phones') {
        <path d="M5 20 Q5 2 20 2 Q35 2 35 20" fill="none" stroke="#1f2544" stroke-width="3" />
      }
      <circle cx="20" cy="20" r="17" [attr.fill]="color()" stroke="#1f2544" stroke-width="2.5" />
      @switch (accessory()) {
        @case ('shades') {
          <path d="M8 13 H32 M9 13 Q9 20 15 20 Q19 20 19 14 M21 14 Q21 20 25 20 Q31 20 31 13" fill="#1f2544" stroke="#1f2544" stroke-width="2" />
        }
        @case ('stars') {
          <path d="M14 10.5 L15.2 14 L18.8 14 L15.9 16.1 L17 19.5 L14 17.4 L11 19.5 L12.1 16.1 L9.2 14 L12.8 14 Z" fill="#ffd166" stroke="#1f2544" stroke-width="1.2" />
          <path d="M26 10.5 L27.2 14 L30.8 14 L27.9 16.1 L29 19.5 L26 17.4 L23 19.5 L24.1 16.1 L21.2 14 L24.8 14 Z" fill="#ffd166" stroke="#1f2544" stroke-width="1.2" />
        }
        @default {
          @if (wink()) {
            <path d="M11 15 Q14 13 17 15" stroke="#1f2544" stroke-width="2.2" fill="none" stroke-linecap="round" />
          } @else {
            <circle cx="14" cy="15" r="2.2" fill="#1f2544" />
          }
          <circle cx="26" cy="15" r="2.2" fill="#1f2544" />
        }
      }
      <path [attr.d]="mouth()" stroke="#1f2544" stroke-width="2.2" fill="#fff" fill-opacity="0.001" stroke-linecap="round" />
      @switch (accessory()) {
        @case ('party') {
          <path d="M13 6 L20 -6 L27 6 Z" fill="#ff6b6b" stroke="#1f2544" stroke-width="1.8" stroke-linejoin="round" />
          <circle cx="20" cy="-6" r="2.2" fill="#ffd166" stroke="#1f2544" stroke-width="1.2" />
        }
        @case ('bolt') {
          <path d="M30 -5 L24 6 L29 6 L25 15 L35 2 L30 2 Z" fill="#ffd166" stroke="#1f2544" stroke-width="1.6" stroke-linejoin="round" />
        }
        @case ('beret') {
          <path d="M7 8 Q10 -3 24 -1 Q35 1 33 8 Q20 4 7 8 Z" fill="#e5484d" stroke="#1f2544" stroke-width="1.8" />
          <path d="M20 -1 L21 -5" stroke="#1f2544" stroke-width="2" />
        }
        @case ('crown') {
          <path d="M9 7 L11 -4 L16 3 L20 -6 L24 3 L29 -4 L31 7 Z" fill="#ffd166" stroke="#1f2544" stroke-width="1.8" stroke-linejoin="round" />
        }
        @case ('captain') {
          <path d="M4.5 12 Q20 4 35.5 12 L35 8 Q20 0 5 8 Z" fill="#1f2544" />
          <path d="M20 4.5 L21 6.8 L23.4 6.8 L21.5 8.3 L22.2 10.6 L20 9.2 L17.8 10.6 L18.5 8.3 L16.6 6.8 L19 6.8 Z" fill="#ffd166" />
        }
        @case ('phones') {
          <rect x="1" y="15" width="6" height="11" rx="2.5" fill="#ff6b6b" stroke="#1f2544" stroke-width="1.8" />
          <rect x="33" y="15" width="6" height="11" rx="2.5" fill="#ff6b6b" stroke="#1f2544" stroke-width="1.8" />
        }
        @case ('wizard') {
          <path d="M8 6 L22 -7 L32 6 Z" fill="#8e6cef" stroke="#1f2544" stroke-width="1.8" stroke-linejoin="round" />
          <path d="M5 6 H35" stroke="#1f2544" stroke-width="2.6" stroke-linecap="round" />
          <circle cx="20" cy="0" r="1.3" fill="#ffd166" />
          <circle cx="24" cy="3" r="1" fill="#ffd166" />
        }
      }
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; }`,
})
export class Avatar {
  readonly index = input(0);
  readonly size = input(36);

  private readonly special = computed(() => UNLOCKABLE[this.index()] ?? null);
  protected readonly accessory = computed<Accessory | null>(() => this.special()?.accessory ?? null);
  protected readonly color = computed(() => this.special()?.color ?? COLORS[this.index() % AVATAR_COUNT]);
  protected readonly mouth = computed(() => MOUTHS[Math.floor(this.index() / 3) % MOUTHS.length]);
  protected readonly wink = computed(() => !this.special() && this.index() % 5 === 4);
}
