import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BRUSH_SIZES, PALETTE } from '@dws/shared';
import { DrawingService } from '../../../core/drawing/drawing.service';

/** Pen/eraser, colours, brush sizes, undo/redo and clear. Keyboard: P, E, Ctrl+Z, Ctrl+Y. */
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
      </div>
      <div class="palette" role="radiogroup" aria-label="Colour">
        @for (c of palette; track c) {
          <button type="button" class="swatch" role="radio" [style.background]="c" [attr.aria-label]="'Colour ' + c"
            [attr.aria-checked]="drawing.color() === c" (click)="pickColor(c)"></button>
        }
      </div>
      <div class="group sizes" role="radiogroup" aria-label="Brush size">
        @for (s of sizes; track s) {
          <button type="button" class="size" role="radio" [attr.aria-checked]="drawing.size() === s"
            [attr.aria-label]="'Brush size ' + s" (click)="drawing.size.set(s)">
            <span [style.width.px]="dot(s)" [style.height.px]="dot(s)"
              [style.background]="drawing.tool() === 'eraser' ? '#fff' : drawing.color()"></span>
          </button>
        }
      </div>
      <div class="group">
        <button type="button" class="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" [disabled]="!drawing.canUndo()" (click)="drawing.undo()">↶</button>
        <button type="button" class="icon-btn" title="Redo (Ctrl+Y)" aria-label="Redo" [disabled]="!drawing.canRedo()" (click)="drawing.redo()">↷</button>
        <button type="button" class="icon-btn" title="Clear canvas" aria-label="Clear canvas" (click)="drawing.clear()">🗑️</button>
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
    .size span { display: block; border-radius: 50%; border: 1.5px solid var(--ink); }
    @media (max-width: 480px) { .palette { grid-template-columns: repeat(8, 22px); } .swatch { width: 22px; height: 22px; } }
  `,
})
export class DrawingToolbar {
  protected readonly drawing = inject(DrawingService);
  protected readonly palette = PALETTE;
  protected readonly sizes = BRUSH_SIZES;

  protected dot(size: number): number {
    return Math.min(26, Math.max(5, size * 0.8));
  }

  protected pickColor(color: string): void {
    this.drawing.color.set(color);
    this.drawing.tool.set('pen');
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    const key = event.key.toLowerCase();
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
    }
  }
}
