import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BRUSH_SIZES, PALETTE } from '@dws/shared';
import { DrawingService } from '../../../core/drawing/drawing.service';

/** Pen/eraser/fill, colours, brush sizes, undo/redo and clear. Keyboard: P, E, F, Ctrl+Z, Ctrl+Y. */
@Component({
  selector: 'app-drawing-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  template: `
    <div class="toolbar" role="toolbar" aria-label="Drawing tools">
      <div class="group">
        <button type="button" class="icon-btn" title="Pencil (P)" aria-label="Pencil"
          [attr.aria-pressed]="drawing.tool() === 'pen'" (click)="drawing.tool.set('pen')">✏️</button>
        <button type="button" class="icon-btn" title="Eraser (E)" aria-label="Eraser"
          [attr.aria-pressed]="drawing.tool() === 'eraser'" (click)="drawing.tool.set('eraser')">🧽</button>
        <button type="button" class="icon-btn" title="Fill (F)" aria-label="Fill" [disabled]="oneStroke()"
          [attr.aria-pressed]="drawing.tool() === 'fill'" (click)="drawing.tool.set('fill')">🪣</button>
      </div>
      <!-- Phones: one colour button and one size button that open small pickers. -->
      <div class="group pickers">
        <button type="button" class="icon-btn current-color" aria-label="Choose colour" [attr.aria-expanded]="open() === 'colors'"
          (click)="toggle('colors')"><span [style.background]="drawing.color()"></span></button>
        <button type="button" class="icon-btn" aria-label="Choose brush size" [attr.aria-expanded]="open() === 'sizes'"
          [disabled]="lockSize()" (click)="toggle('sizes')">
          <span class="dot" [style.width.px]="dot(drawing.size()) * 0.7" [style.height.px]="dot(drawing.size()) * 0.7"></span>
        </button>
      </div>
      <div class="palette" role="radiogroup" aria-label="Colour" [class.popup]="open() === 'colors'">
        @for (c of palette(); track c) {
          <button type="button" class="swatch" role="radio" [style.background]="c" [attr.aria-label]="'Colour ' + c"
            [attr.aria-checked]="drawing.color() === c" (click)="pickColor(c)"></button>
        }
      </div>
      <div class="group sizes" role="radiogroup" aria-label="Brush size" [class.popup]="open() === 'sizes'">
        @for (s of sizes; track s) {
          <button type="button" class="size" role="radio" [attr.aria-checked]="drawing.size() === s" [disabled]="lockSize()"
            [attr.aria-label]="'Brush size ' + s" (click)="drawing.size.set(s); open.set(null)">
            <span [style.width.px]="dot(s)" [style.height.px]="dot(s)"
              [style.background]="drawing.tool() === 'eraser' ? '#fff' : drawing.color()"></span>
          </button>
        }
      </div>
      <div class="group">
        <button type="button" class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" [disabled]="oneStroke() || !drawing.canUndo()" (click)="drawing.undo()">↶</button>
        <button type="button" class="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" [disabled]="oneStroke() || !drawing.canRedo()" (click)="drawing.redo()">↷</button>
        <button type="button" class="icon-btn" title="Clear canvas" aria-label="Clear canvas" [disabled]="oneStroke()" (click)="drawing.clear()">🗑️</button>
      </div>
    </div>
  `,
  styles: `
    .toolbar {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px;
      padding: 8px; background: #fff; border: 2px solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow-sm);
    }
    .group { display: flex; gap: 6px; align-items: center; }
    .palette { display: grid; grid-template-columns: repeat(8, 26px); gap: 4px; }
    .swatch { width: 26px; height: 26px; border-radius: 8px; border: 2px solid var(--ink); cursor: pointer; padding: 0; }
    .swatch[aria-checked='true'] { outline: 3px solid var(--sky); outline-offset: 1px; }
    .size {
      width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; cursor: pointer;
      border: 2px solid transparent; background: #f3f0ea;
    }
    .size[aria-checked='true'] { border-color: var(--ink); background: var(--sun); }
    .size:disabled { cursor: not-allowed; opacity: 0.6; }
    .icon-btn:disabled { opacity: 0.35; }
    .size span { display: block; border-radius: 50%; border: 1.5px solid var(--ink); }
    .toolbar { position: relative; }
    .pickers { display: none; }
    .current-color span { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--ink); }
    .dot { display: block; border-radius: 50%; background: var(--ink); min-width: 4px; min-height: 4px; }
    @media (max-width: 600px) {
      /* One row: tools · colour · size · undo/redo/clear. Pickers pop up above the toolbar. */
      .toolbar { flex-wrap: nowrap; justify-content: space-between; gap: 4px; padding: 5px 6px; }
      .group { gap: 4px; }
      .icon-btn { width: 36px; height: 36px; font-size: 1rem; box-shadow: none; }
      .pickers { display: flex; }
      .palette, .sizes { display: none; }
      .palette.popup, .sizes.popup {
        display: grid; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 5;
        padding: 8px; background: #fff; border: 2px solid var(--ink); border-radius: 14px; box-shadow: var(--shadow);
      }
      .palette.popup { grid-template-columns: repeat(8, 30px); gap: 6px; }
      .palette.popup .swatch { width: 30px; height: 30px; }
      .sizes.popup { display: flex; gap: 6px; }
    }
  `,
})
export class DrawingToolbar {
  protected readonly drawing = inject(DrawingService);
  /** Chaos "tiny palette" restricts the colours. */
  protected readonly palette = computed<readonly string[]>(() => this.drawing.constraints().palette ?? PALETTE);
  protected readonly lockSize = computed(() => this.drawing.constraints().lockSize);
  protected readonly oneStroke = computed(() => this.drawing.constraints().oneStroke);
  protected readonly sizes = BRUSH_SIZES;

  protected readonly open = signal<'colors' | 'sizes' | null>(null);

  protected toggle(panel: 'colors' | 'sizes'): void {
    this.open.update((current) => (current === panel ? null : panel));
  }

  protected dot(size: number): number {
    return Math.min(26, Math.max(5, size * 0.8));
  }

  protected pickColor(color: string): void {
    this.open.set(null);
    this.drawing.color.set(color);
    if (this.drawing.tool() === 'eraser') this.drawing.tool.set('pen');
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const key = event.key.toLowerCase();
    if (this.oneStroke() && (event.ctrlKey || event.metaKey)) return;
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.drawing.redo();
      else this.drawing.undo();
    } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      this.drawing.redo();
    } else if (!event.ctrlKey && !event.metaKey && key === 'e') {
      this.drawing.tool.set('eraser');
    } else if (!event.ctrlKey && !event.metaKey && key === 'p') {
      this.drawing.tool.set('pen');
    } else if (!event.ctrlKey && !event.metaKey && key === 'f' && !this.oneStroke()) {
      this.drawing.tool.set('fill');
    }
  }
}
