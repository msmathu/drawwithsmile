import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { BRUSH_SIZES, LIMITS, type ClearOp, type DrawOp, type FillOp, type StrokeChunk, type Tool } from '@dws/shared';
import { SocketService } from '../services/socket.service';
import { DrawingEngine, renderAll, renderFill, renderStroke, type Viewport } from './drawing-engine';

const FLUSH_INTERVAL_MS = 50;
/** Ignore pointer moves smaller than this (normalised units) to save bandwidth. */
const MIN_POINT_DISTANCE = 12;

function strokeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/**
 * Provide `true` (together with a component-level DrawingService) for a private
 * practice canvas: strokes stay on this device and nothing is sent to the server.
 */
export const DRAWING_PRACTICE_MODE = new InjectionToken<boolean>('DRAWING_PRACTICE_MODE');

/** Chaos Drawing constraints for the local drawer (the server enforces the rules too). */
export interface DrawingConstraints {
  /** Invisible ink: your line appears only when you lift the pen. */
  hideInk: boolean;
  /** Mirror hands: input is flipped along this axis. */
  flip: 'horizontal' | 'vertical' | null;
  /** Tiny palette: only these colours. */
  palette: string[] | null;
  /** Wobbly brush: the size is chosen automatically. */
  lockSize: boolean;
  /** One stroke: no second stroke, fill, undo or clear. */
  oneStroke: boolean;
}

export const NO_CONSTRAINTS: DrawingConstraints = { hideInk: false, flip: null, palette: null, lockSize: false, oneStroke: false };

/**
 * Owns the drawing state for the current turn: renders remote strokes, captures
 * local strokes for the drawer and streams them to the server in small batches.
 */
@Injectable({ providedIn: 'root' })
export class DrawingService {
  private readonly socket = inject(SocketService);
  private readonly engine = new DrawingEngine();
  /** Local-only canvas (lobby practice) instead of the shared game canvas. */
  readonly practice = inject(DRAWING_PRACTICE_MODE, { optional: true }) ?? false;
  private ctx: CanvasRenderingContext2D | null = null;
  private viewport: Viewport = { width: 0, height: 0 };

  readonly tool = signal<Tool>('pen');
  readonly color = signal<string>('#000000');
  readonly size = signal<number>(BRUSH_SIZES[1]);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly constraints = signal<DrawingConstraints>(NO_CONSTRAINTS);
  /** One-stroke challenge: the single stroke has been used. */
  readonly strokeUsed = signal(false);

  // Local stroke being drawn.
  private active: { id: string; pending: number[]; pairs: number; lastX: number; lastY: number } | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (this.practice) return;
    this.socket.on('draw:history', (ops) => this.setHistory(ops));
    this.socket.on('draw:chunk', (chunk) => this.drawChunk(chunk));
    this.socket.on('draw:undo', ({ opId }) => {
      if (this.engine.undo(opId)) this.redraw();
    });
    this.socket.on('draw:redo', (op) => {
      this.engine.redo(op);
      this.redraw();
    });
    this.socket.on('draw:fill', (op) => this.applyFill(op));
    this.socket.on('draw:clear', (op: ClearOp) => {
      this.engine.clear(op);
      this.redraw();
    });
  }

  attach(canvas: HTMLCanvasElement): void {
    this.ctx = canvas.getContext('2d');
  }

  detach(): void {
    this.endStroke();
    this.ctx = null;
  }

  /** Called when the canvas element is resized; repaints from history so nothing is lost. */
  resize(width: number, height: number, devicePixelRatio: number): void {
    if (!this.ctx) return;
    const canvas = this.ctx.canvas;
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    this.viewport = { width, height };
    this.redraw();
  }

  /** Applies chaos constraints (or clears them) when the pen changes hands. */
  setConstraints(next: DrawingConstraints): void {
    this.endStroke();
    this.constraints.set(next);
    this.strokeUsed.set(false);
    if (next.palette && !next.palette.includes(this.color())) this.color.set(next.palette[0]!);
    if (next.oneStroke && this.tool() === 'fill') this.tool.set('pen');
  }

  /** A small PNG of the current picture (for the end-of-round vote). */
  snapshot(width = 240): string | null {
    const source = this.ctx?.canvas;
    if (!source || source.width === 0) return null;
    const thumb = document.createElement('canvas');
    thumb.width = width;
    thumb.height = Math.round((width * source.height) / source.width);
    const ctx = thumb.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
    try {
      return thumb.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  setHistory(ops: DrawOp[]): void {
    this.active = null;
    this.engine.reset(ops);
    this.redraw();
  }

  // ------------------------------------------------------------ drawer input

  /** Starts a stroke at normalised coordinates. */
  beginStroke(rawX: number, rawY: number): void {
    this.endStroke();
    if (this.constraints().oneStroke && this.strokeUsed()) return;
    const [x, y] = this.mapInput(rawX, rawY);
    this.active = { id: strokeId(), pending: [], pairs: 0, lastX: x, lastY: y };
    this.strokeUsed.set(true);
    this.addPoint(x, y);
    this.flushTimer = setInterval(() => this.flush(false), FLUSH_INTERVAL_MS);
  }

  extendStroke(rawX: number, rawY: number): void {
    const a = this.active;
    if (!a) return;
    const [x, y] = this.mapInput(rawX, rawY);
    if (Math.hypot(x - a.lastX, y - a.lastY) < MIN_POINT_DISTANCE) return;
    if (a.pairs >= LIMITS.STROKE_MAX_POINTS - 1) {
      if (this.constraints().oneStroke) return; // a single stroke can't be split
      // Very long stroke: finish it and continue seamlessly with a new one.
      const { lastX, lastY } = a;
      this.endStroke();
      this.beginStroke(lastX, lastY);
    }
    this.addPoint(x, y);
  }

  endStroke(): void {
    const a = this.active;
    if (!a) return;
    if (a.pending.length === 0) a.pending.push(a.lastX, a.lastY);
    this.flush(true);
    this.active = null;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = null;
    // Invisible ink: reveal the finished line now.
    if (this.constraints().hideInk) this.redraw();
  }

  /** Paint-bucket fill at normalised coordinates. */
  fillAt(rawX: number, rawY: number): void {
    this.endStroke();
    if (this.constraints().oneStroke) return;
    const [x, y] = this.mapInput(rawX, rawY);
    const op: FillOp = {
      kind: 'fill',
      id: strokeId(),
      color: this.color(),
      x: Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, x))),
      y: Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, y))),
    };
    this.applyFill(op);
    if (!this.practice) this.socket.send('draw:fill', { id: op.id, color: op.color, x: op.x, y: op.y });
  }

  undo(): void {
    this.endStroke();
    if (!this.practice) return this.socket.send('draw:undo');
    const last = this.engine.history.at(-1);
    if (last && this.engine.undo(last.id)) this.redraw();
  }

  redo(): void {
    this.endStroke();
    if (!this.practice) return this.socket.send('draw:redo');
    const op = this.engine.peekRedo();
    if (op) {
      this.engine.redo(op);
      this.redraw();
    }
  }

  clear(): void {
    this.endStroke();
    if (!this.practice) return this.socket.send('draw:clear');
    if (this.engine.visibleOps().length === 0) return;
    this.engine.clear({ kind: 'clear', id: strokeId() });
    this.redraw();
  }

  private addPoint(x: number, y: number): void {
    const a = this.active!;
    const px = Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, x)));
    const py = Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, y)));
    a.pending.push(px, py);
    a.pairs++;
    a.lastX = px;
    a.lastY = py;
    // Render locally right away for zero-latency drawing (unless the ink is invisible).
    this.drawChunk(this.chunk(a.id, [px, py], false), !this.constraints().hideInk);
    if (a.pending.length / 2 >= LIMITS.CHUNK_MAX_POINTS) this.flush(false);
  }

  private flush(final: boolean): void {
    const a = this.active;
    if (!a || (a.pending.length === 0 && !final)) return;
    if (!this.practice) this.socket.send('draw:chunk', this.chunk(a.id, a.pending, final));
    a.pending = [];
  }

  private chunk(id: string, points: number[], final: boolean): StrokeChunk {
    return { id, tool: this.tool() === 'eraser' ? 'eraser' : 'pen', color: this.color(), size: this.size(), points, final };
  }

  private applyFill(op: FillOp): void {
    this.engine.applyFill(op);
    this.syncFlags();
    if (this.ctx && this.viewport.width > 0) renderFill(this.ctx, op);
  }

  // ------------------------------------------------------------ rendering

  private drawChunk(chunk: StrokeChunk, render = true): void {
    const { stroke, fromPair } = this.engine.applyChunk(chunk);
    this.syncFlags();
    if (render && this.ctx && this.viewport.width > 0) renderStroke(this.ctx, stroke, this.viewport, fromPair);
  }

  /** Mirror hands: flips the drawer's input. */
  private mapInput(x: number, y: number): [number, number] {
    const flip = this.constraints().flip;
    return [flip === 'horizontal' ? LIMITS.COORD_MAX - x : x, flip === 'vertical' ? LIMITS.COORD_MAX - y : y];
  }

  private redraw(): void {
    this.syncFlags();
    if (this.ctx && this.viewport.width > 0) renderAll(this.ctx, this.engine.visibleOps(), this.viewport);
  }

  private syncFlags(): void {
    this.canUndo.set(this.engine.canUndo);
    this.canRedo.set(this.engine.canRedo);
  }
}
