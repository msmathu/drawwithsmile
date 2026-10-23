import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const COLORS = ['#ffc83d', '#ff6b6b', '#1fb5a8', '#4d96ff', '#8e6cef', '#ff9f43', '#6ad08b', '#f78fb3', '#54c7ec', '#c8a2ff', '#ffd166', '#9be564'];
const MOUTHS = [
  'M12 22 Q20 30 28 22', // smile
  'M12 22 Q20 32 28 22 Z', // open grin
  'M13 24 Q20 27 27 24', // calm
  'M12 22 Q20 30 28 22 M18 26 Q20 31 22 26', // tongue
];

/** Smiley avatar generated from an index — no images needed. */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="17" [attr.fill]="color()" stroke="#1f2544" stroke-width="2.5" />
      @if (wink()) {
        <path d="M11 15 Q14 13 17 15" stroke="#1f2544" stroke-width="2.2" fill="none" stroke-linecap="round" />
      } @else {
        <circle cx="14" cy="15" r="2.2" fill="#1f2544" />
      }
      <circle cx="26" cy="15" r="2.2" fill="#1f2544" />
      <path [attr.d]="mouth()" stroke="#1f2544" stroke-width="2.2" fill="#fff" fill-opacity="0.001" stroke-linecap="round" />
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; }`,
})
export class Avatar {
  readonly index = input(0);
  readonly size = input(36);
  protected readonly color = computed(() => COLORS[this.index() % COLORS.length]);
  protected readonly mouth = computed(() => MOUTHS[Math.floor(this.index() / 3) % MOUTHS.length]);
  protected readonly wink = computed(() => this.index() % 5 === 4);
}
