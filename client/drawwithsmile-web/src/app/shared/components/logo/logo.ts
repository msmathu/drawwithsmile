import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Original DrawWithSmile mark: a smiling face being drawn by a pencil. */
@Component({
  selector: 'app-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="logo" [class.compact]="compact()">
      <svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="30" cy="32" r="24" fill="#ffc83d" stroke="#1f2544" stroke-width="3.5" />
        <circle cx="22" cy="27" r="3.2" fill="#1f2544" />
        <circle cx="37" cy="27" r="3.2" fill="#1f2544" />
        <path d="M18 37 Q29.5 49 41 37" fill="none" stroke="#1f2544" stroke-width="3.5" stroke-linecap="round" />
        <circle cx="16" cy="35" r="3" fill="#ff6b6b" opacity="0.6" />
        <circle cx="43" cy="35" r="3" fill="#ff6b6b" opacity="0.6" />
        <g transform="rotate(40 50 46)">
          <rect x="45" y="30" width="10" height="26" rx="2" fill="#4d96ff" stroke="#1f2544" stroke-width="2.5" />
          <rect x="45" y="30" width="10" height="6" rx="2" fill="#ff6b6b" stroke="#1f2544" stroke-width="2.5" />
          <path d="M45 56 L50 64 L55 56 Z" fill="#fde6c8" stroke="#1f2544" stroke-width="2.5" stroke-linejoin="round" />
        </g>
      </svg>
      <span class="word">
        <span class="w1">Draw</span><span class="w2">With</span><span class="w3">Smile</span>
      </span>
    </span>
  `,
  styles: `
    .logo { display: inline-flex; align-items: center; gap: 10px; color: var(--ink); }
    .mark { width: 76px; height: 76px; flex: none; }
    .word { font-size: 2.6rem; font-weight: 800; letter-spacing: -0.5px; line-height: 1; }
    .w1 { color: var(--ink); }
    .w2 { color: var(--coral); }
    .w3 { color: var(--teal); }
    .compact .mark { width: 38px; height: 38px; }
    .compact .word { font-size: 1.35rem; }
    @media (max-width: 420px) { .logo:not(.compact) .word { font-size: 2rem; } .logo:not(.compact) .mark { width: 58px; height: 58px; } }
  `,
})
export class Logo {
  readonly compact = input(false);
}
