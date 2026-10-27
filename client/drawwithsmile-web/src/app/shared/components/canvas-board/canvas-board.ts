import {
  type AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  type OnDestroy,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { LIMITS } from '@dws/shared';
import { DrawingService } from '../../../core/drawing/drawing.service';

/**
 * The shared drawing surface. Uses Pointer Events, so mouse, touch and stylus
 * all work; only the current drawer's input is captured.
 */
@Component({
  selector: 'app-canvas-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame" #frame>
      <canvas
        #canvas
        [class.can-draw]="canDraw()"
        [class.no-cursor]="canDraw() && drawing.constraints().hideInk"
        [attr.aria-label]="canDraw() ? 'Drawing canvas — draw your word here' : 'Drawing canvas'"
        role="img"
        (pointerdown)="onDown($event)"
        (pointermove)="onMove($event)"
        (pointerup)="onUp($event)"
        (pointercancel)="onUp($event)"
        (lostpointercapture)="onUp($event)"
        (contextmenu)="$event.preventDefault()"
      ></canvas>
      <ng-content />
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; }
    .frame {
      position: relative; width: 100%; aspect-ratio: 4 / 3; background: #fff;
      border: 2px solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
    }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; -webkit-user-select: none; }
    canvas.can-draw { cursor: crosshair; }
    canvas.no-cursor { cursor: none; }
  `,
})
export class CanvasBoard implements AfterViewInit, OnDestroy {
  protected readonly drawing = inject(DrawingService);
  readonly canDraw = input(false);

  private readonly frame = viewChild.required<ElementRef<HTMLDivElement>>('frame');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private observer: ResizeObserver | null = null;
  private activePointer: number | null = null;

  constructor() {
    effect(() => {
      if (!this.canDraw() && this.activePointer !== null) {
        this.activePointer = null;
        this.drawing.endStroke();
      }
    });
  }

  ngAfterViewInit(): void {
    const canvas = this.canvas().nativeElement;
    this.drawing.attach(canvas);
    this.observer = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0) this.drawing.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    });
    this.observer.observe(this.frame().nativeElement);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    this.drawing.detach();
  }

  protected onDown(event: PointerEvent): void {
    if (!this.canDraw() || this.activePointer !== null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (this.drawing.tool() === 'fill') {
      const [fx, fy] = this.normalise(event);
      this.drawing.fillAt(fx, fy);
      return;
    }
    const canvas = this.canvas().nativeElement;
    canvas.setPointerCapture(event.pointerId);
    this.activePointer = event.pointerId;
    const [x, y] = this.normalise(event);
    this.drawing.beginStroke(x, y);
  }

  protected onMove(event: PointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    for (const e of events.length ? events : [event]) {
      const [x, y] = this.normalise(e);
      this.drawing.extendStroke(x, y);
    }
  }

  protected onUp(event: PointerEvent): void {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.drawing.endStroke();
  }

  private normalise(event: PointerEvent): [number, number] {
    const rect = this.canvas().nativeElement.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * LIMITS.COORD_MAX,
      ((event.clientY - rect.top) / rect.height) * LIMITS.COORD_MAX,
    ];
  }
}
