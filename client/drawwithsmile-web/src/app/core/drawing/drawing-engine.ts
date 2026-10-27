import {
  CANVAS_BACKGROUND,
  LIMITS,
  REFERENCE_CANVAS_WIDTH,
  type ClearOp,
  type DrawOp,
  type FillOp,
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

  /** The operation the next redo would restore (local practice mode). */
  peekRedo(): DrawOp | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  redo(op: DrawOp): void {
    this.redoStack = this.redoStack.filter((o) => o.id !== op.id);
    this.ops.push(op);
  }

  applyFill(op: FillOp): void {
    this.ops.push(op);
    this.redoStack = [];
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

/** Clears the canvas and replays every visible operation in order. */
export function renderAll(ctx: CanvasRenderingContext2D, ops: readonly DrawOp[], viewport: Viewport): void {
  ctx.fillStyle = CANVAS_BACKGROUND;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  for (const op of ops) {
    if (op.kind === 'stroke') renderStroke(ctx, op, viewport);
    else if (op.kind === 'fill') renderFill(ctx, op);
  }
}

/** Applies a paint-bucket fill to the canvas pixels (works at any canvas resolution). */
export function renderFill(ctx: CanvasRenderingContext2D, op: FillOp): void {
  const { width, height } = ctx.canvas;
  if (width === 0 || height === 0) return;
  const x = Math.min(width - 1, Math.max(0, Math.floor((op.x / LIMITS.COORD_MAX) * width)));
  const y = Math.min(height - 1, Math.max(0, Math.floor((op.y / LIMITS.COORD_MAX) * height)));
  const image = ctx.getImageData(0, 0, width, height);
  if (floodFillPixels(image.data, width, height, x, y, hexToRgb(op.color)) > 0) ctx.putImageData(image, 0, 0);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Scanline flood fill on raw RGBA pixels. Fills every pixel connected to (sx, sy)
 * whose colour is within `tolerance` of the start pixel, then grows the area by one
 * pixel so anti-aliased line edges do not leave a light halo. Returns pixels filled.
 */
export function floodFillPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  sx: number,
  sy: number,
  [fr, fg, fb]: [number, number, number],
  tolerance = 64,
): number {
  const start = (sy * width + sx) * 4;
  const tr = data[start]!;
  const tg = data[start + 1]!;
  const tb = data[start + 2]!;
  // Already this colour: nothing to do.
  if (Math.abs(tr - fr) <= 8 && Math.abs(tg - fg) <= 8 && Math.abs(tb - fb) <= 8) return 0;

  const filled = new Uint8Array(width * height);
  const matches = (p: number) => {
    if (filled[p]) return false;
    const i = p * 4;
    return (
      Math.abs(data[i]! - tr) <= tolerance && Math.abs(data[i + 1]! - tg) <= tolerance && Math.abs(data[i + 2]! - tb) <= tolerance
    );
  };

  let count = 0;
  const stack: number[] = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * width + x;
    if (!matches(p)) continue;
    while (x > 0 && matches(p - 1)) {
      x--;
      p--;
    }
    let spanAbove = false;
    let spanBelow = false;
    while (x < width && matches(p)) {
      filled[p] = 1;
      count++;
      if (y > 0) {
        const up = matches(p - width);
        if (up && !spanAbove) stack.push(x, y - 1);
        spanAbove = up;
      }
      if (y < height - 1) {
        const down = matches(p + width);
        if (down && !spanBelow) stack.push(x, y + 1);
        spanBelow = down;
      }
      x++;
      p++;
    }
  }

  // Paint the region plus a one-pixel border to cover anti-aliased edges.
  for (let p = 0; p < filled.length; p++) {
    if (!filled[p]) continue;
    const x = p % width;
    for (const q of [p, x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (q < 0 || q >= filled.length) continue;
      const i = q * 4;
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = 255;
    }
  }
  return count;
}
