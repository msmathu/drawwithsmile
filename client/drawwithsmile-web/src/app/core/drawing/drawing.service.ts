import { Injectable, inject, signal } from '@angular/core';
import { BRUSH_SIZES, LIMITS, type ClearOp, type DrawOp, type StrokeChunk, type Tool } from '@dws/shared';
import { SocketService } from '../services/socket.service';
import { DrawingEngine, renderAll, renderStroke, type Viewport } from './drawing-engine';

const FLUSH_INTERVAL_MS = 50;
/** Ignore pointer moves smaller than this (normalised units) to save bandwidth. */
const MIN_POINT_DISTANCE = 12;

function strokeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

/**
 * Owns the drawing state for the current turn: renders remote strokes, captures
 * local strokes for the drawer and streams them to the server in small batches.
 */
@Injectable({ providedIn: 'root' })
export class DrawingService {
  private readonly socket = inject(SocketService);
  private readonly engine = new DrawingEngine();
  private ctx: CanvasRenderingContext2D | null = null;
  private viewport: Viewport = { width: 0, height: 0 };

  readonly tool = signal<Tool>('pen');
  readonly color = signal<string>('#000000');
  readonly size = signal<number>(BRUSH_SIZES[1]);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  // Local stroke being drawn.
  private active: { id: string; pending: number[]; pairs: number; lastX: number; lastY: number } | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.socket.on('draw:history', (ops) => this.setHistory(ops));
    this.socket.on('draw:chunk', (chunk) => this.drawChunk(chunk));
    this.socket.on('draw:undo', ({ opId }) => {
      if (this.engine.undo(opId)) this.redraw();
    });
    this.socket.on('draw:redo', (op) => {
      this.engine.redo(op);
      this.redraw();
    });
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

  setHistory(ops: DrawOp[]): void {
    this.active = null;
    this.engine.reset(ops);
    this.redraw();
  }

  // ------------------------------------------------------------ drawer input

  /** Starts a stroke at normalised coordinates. */
  beginStroke(x: number, y: number): void {
    this.endStroke();
    this.active = { id: strokeId(), pending: [], pairs: 0, lastX: x, lastY: y };
    this.addPoint(x, y);
    this.flushTimer = setInterval(() => this.flush(false), FLUSH_INTERVAL_MS);
  }

  extendStroke(x: number, y: number): void {
    const a = this.active;
    if (!a) return;
    if (Math.hypot(x - a.lastX, y - a.lastY) < MIN_POINT_DISTANCE) return;
    if (a.pairs >= LIMITS.STROKE_MAX_POINTS - 1) {
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
  }

  undo(): void {
    this.endStroke();
    this.socket.send('draw:undo');
  }

  redo(): void {
    this.endStroke();
    this.socket.send('draw:redo');
  }

  clear(): void {
    this.endStroke();
    this.socket.send('draw:clear');
  }

  private addPoint(x: number, y: number): void {
    const a = this.active!;
    const px = Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, x)));
    const py = Math.round(Math.min(LIMITS.COORD_MAX, Math.max(0, y)));
    a.pending.push(px, py);
    a.pairs++;
    a.lastX = px;
    a.lastY = py;
    // Render locally right away for zero-latency drawing.
    this.drawChunk(this.chunk(a.id, [px, py], false));
    if (a.pending.length / 2 >= LIMITS.CHUNK_MAX_POINTS) this.flush(false);
  }

  private flush(final: boolean): void {
    const a = this.active;
    if (!a || (a.pending.length === 0 && !final)) return;
    this.socket.send('draw:chunk', this.chunk(a.id, a.pending, final));
    a.pending = [];
  }

  private chunk(id: string, points: number[], final: boolean): StrokeChunk {
    return { id, tool: this.tool(), color: this.color(), size: this.size(), points, final };
  }

  // ------------------------------------------------------------ rendering

  private drawChunk(chunk: StrokeChunk): void {
    const { stroke, fromPair } = this.engine.applyChunk(chunk);
    this.syncFlags();
    if (this.ctx && this.viewport.width > 0) renderStroke(this.ctx, stroke, this.viewport, fromPair);
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
