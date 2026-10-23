import {
  CANVAS_BACKGROUND,
  LIMITS,
  REFERENCE_CANVAS_WIDTH,
  type ClearOp,
  type DrawOp,
  type StrokeChunk,
  type StrokeOp,
} from '@dws/shared';

/**
 * Client-side mirror of the drawing history. Coordinates are normalised integers
 * (0..COORD_MAX), so the picture can be re-rendered at any canvas size.
 */
export class DrawingEngine {
  private ops: DrawOp[] = [];
  private redoStack: DrawOp[] = [];

  get history(): readonly DrawOp[] {
    return this.ops;
  }

  get canUndo(): boolean {
    return this.ops.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  reset(ops: DrawOp[]): void {
    this.ops = ops.map((op) => (op.kind === 'stroke' ? { ...op, points: [...op.points] } : { ...op }));
    this.redoStack = [];
  }

  /**
   * Adds a chunk to its stroke (creating the stroke for a new id).
   * Returns the stroke and the pair index where the new points start.
   */
  applyChunk(chunk: StrokeChunk): { stroke: StrokeOp; fromPair: number } {
    const last = this.ops[this.ops.length - 1];
    let stroke: StrokeOp;
    if (last?.kind === 'stroke' && last.id === chunk.id) {
      stroke = last;
    } else {
      stroke = { kind: 'stroke', id: chunk.id, tool: chunk.tool, color: chunk.color, size: chunk.size, points: [] };
      this.ops.push(stroke);
      this.redoStack = [];
    }
    const fromPair = stroke.points.length / 2;
    stroke.points.push(...chunk.points);
    return { stroke, fromPair };
  }

  undo(opId: string): boolean {
    const index = this.ops.findIndex((op) => op.id === opId);
    if (index < 0) return false;
    const [op] = this.ops.splice(index, 1);
    this.redoStack.push(op!);
    return true;
  }

  redo(op: DrawOp): void {
    this.redoStack = this.redoStack.filter((o) => o.id !== op.id);
    this.ops.push(op);
  }

  clear(op: ClearOp): void {
    this.ops.push(op);
    this.redoStack = [];
  }

  /** Operations that are visible: everything after the last clear. */
  visibleOps(): DrawOp[] {
    let start = 0;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      if (this.ops[i]!.kind === 'clear') {
        start = i + 1;
        break;
      }
    }
    return this.ops.slice(start);
  }
}

export interface Viewport {
  width: number;
  height: number;
}

export function lineWidthFor(size: number, viewport: Viewport): number {
  return Math.max(1, size * (viewport.width / REFERENCE_CANVAS_WIDTH));
}

function toPx(value: number, extent: number): number {
  return (value / LIMITS.COORD_MAX) * extent;
}

/** Draws part of a stroke, starting at pair index `fromPair` (connecting to the previous point). */
export function renderStroke(ctx: CanvasRenderingContext2D, stroke: StrokeOp, viewport: Viewport, fromPair = 0): void {
  const pts = stroke.points;
  const pairs = pts.length / 2;
  if (pairs === 0 || fromPair >= pairs) return;
  const color = stroke.tool === 'eraser' ? CANVAS_BACKGROUND : stroke.color;
  const width = lineWidthFor(stroke.size, viewport);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pairs === 1) {
    ctx.beginPath();
    ctx.arc(toPx(pts[0]!, viewport.width), toPx(pts[1]!, viewport.height), width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  const start = Math.max(0, fromPair - 1);
  ctx.beginPath();
  ctx.moveTo(toPx(pts[start * 2]!, viewport.width), toPx(pts[start * 2 + 1]!, viewport.height));
  for (let i = start + 1; i < pairs; i++) {
    ctx.lineTo(toPx(pts[i * 2]!, viewport.width), toPx(pts[i * 2 + 1]!, viewport.height));
  }
  ctx.stroke();
}

/** Clears the canvas and replays every visible operation. */
export function renderAll(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[], viewport: Viewport): void {
  ctx.fillStyle = CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  for (const op of ops) {
    if (op.kind === 'stroke') renderStroke(ctx, op, viewport);
  }
}
