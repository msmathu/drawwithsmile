import { ChangeDetectionStrategy, Component, type ElementRef, afterNextRender, input, output, viewChild } from '@angular/core';

/** Accessible dialog: closes on Escape, backdrop click or the ✕ button. */
@Component({
  selector: 'app-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="backdrop" (click)="closed.emit()"></div>
    <section class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="heading()" tabindex="-1" #dialog>
      <header>
        <h2>{{ heading() }}</h2>
        <button type="button" class="close" aria-label="Close" (click)="closed.emit()">✕</button>
      </header>
      <div class="body"><ng-content /></div>
    </section>
  `,
  styles: `
    :host { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 16px; }
    .backdrop { position: absolute; inset: 0; background: rgba(31, 37, 68, 0.55); }
    .dialog {
      position: relative; width: min(100%, 440px); max-height: calc(100dvh - 32px); display: flex; flex-direction: column;
      background: #fff; border: 2px solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
      animation: pop 0.15s ease-out;
    }
    .dialog:focus { outline: none; }
    header { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: var(--sun); border-bottom: 2px solid var(--ink); }
    h2 { margin: 0; font-size: 1.2rem; }
    .close { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--ink); background: #fff; cursor: pointer; font-weight: 800; }
    .body { padding: 16px; overflow-y: auto; }
    @keyframes pop { from { transform: scale(0.95); opacity: 0; } }
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly closed = output<void>();
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');

  constructor() {
    afterNextRender(() => this.dialog().nativeElement.focus());
  }
}
