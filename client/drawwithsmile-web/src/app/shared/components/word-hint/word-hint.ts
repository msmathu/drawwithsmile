import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { splitGraphemes } from '@dws/shared';

/** Shows the masked word (guessers) or the full word (drawer / turn end). */
@Component({
  selector: 'app-word-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (cells().length) {
      <div class="hint" [class.reveal]="!!word()" [attr.aria-label]="label()">
        @for (cell of cells(); track $index) {
          @if (cell === ' ') {
            <span class="gap"></span>
          } @else {
            <span class="cell" [class.blank]="cell === null">{{ cell ?? '' }}</span>
          }
        }
        @if (!word()) {
          <span class="count">{{ letterCount() }}</span>
        }
      </div>
    }
  `,
  styles: `
    .hint { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: center; gap: 4px; }
    .cell {
      min-width: 22px; padding: 0 2px; text-align: center; font-size: 1.35rem; font-weight: 800;
      border-bottom: 3px solid var(--ink); line-height: 1.2;
    }
    .cell.blank { color: transparent; }
    .reveal .cell { color: var(--teal); border-color: var(--teal); }
    .gap { width: 12px; }
    .count { margin-left: 6px; font-size: 0.8rem; font-weight: 700; color: var(--ink-soft); align-self: center; }
    @media (max-width: 480px) { .cell { min-width: 16px; font-size: 1.1rem; } }
  `,
})
export class WordHint {
  /** Masked graphemes from the server (null = hidden). */
  readonly hint = input<(string | null)[] | null>(null);
  /** Full word, when this player is allowed to see it. */
  readonly word = input<string | null>(null);

  protected readonly cells = computed<(string | null)[]>(() => {
    const word = this.word();
    return word ? splitGraphemes(word) : (this.hint() ?? []);
  });
  protected readonly letterCount = computed(() => this.cells().filter((c) => c !== ' ').length);
  protected readonly label = computed(() =>
    this.word() ? `The word is ${this.word()}` : `Hidden word with ${this.letterCount()} letters`,
  );
}
