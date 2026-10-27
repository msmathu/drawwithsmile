import { DrawingEngine, floodFillPixels, hexToRgb, lineWidthFor } from './drawing-engine';

const chunk = (id: string, points: number[], final = false) => ({
  id,
  tool: 'pen' as const,
  color: '#000000',
  size: 6,
  points,
  final,
});

describe('DrawingEngine', () => {
  it('builds strokes from chunks and reports where new points start', () => {
    const engine = new DrawingEngine();
    expect(engine.applyChunk(chunk('a', [1, 1, 2, 2])).fromPair).toBe(0);
    const { stroke, fromPair } = engine.applyChunk(chunk('a', [3, 3], true));
    expect(fromPair).toBe(2);
    expect(stroke.points).toEqual([1, 1, 2, 2, 3, 3]);
    expect(engine.history).toHaveLength(1);
  });

  it('mirrors undo, redo and clear from the server', () => {
    const engine = new DrawingEngine();
    engine.applyChunk(chunk('a', [1, 1]));
    engine.applyChunk(chunk('b', [2, 2]));
    expect(engine.undo('b')).toBe(true);
    expect(engine.canRedo).toBe(true);
    expect(engine.visibleOps().map((o) => o.id)).toEqual(['a']);
    engine.redo({ kind: 'stroke', id: 'b', tool: 'pen', color: '#000000', size: 6, points: [2, 2] });
    expect(engine.canRedo).toBe(false);
    engine.clear({ kind: 'clear', id: 'c' });
    expect(engine.visibleOps()).toEqual([]);
    engine.undo('c');
    expect(engine.visibleOps().map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('resets from history for late joiners', () => {
    const engine = new DrawingEngine();
    engine.applyChunk(chunk('a', [1, 1]));
    engine.reset([{ kind: 'stroke', id: 'x', tool: 'eraser', color: '#000000', size: 12, points: [5, 5] }]);
    expect(engine.history.map((o) => o.id)).toEqual(['x']);
    expect(engine.canRedo).toBe(false);
  });

  it('scales brush width with the canvas size', () => {
    expect(lineWidthFor(6, { width: 800, height: 600 })).toBe(6);
    expect(lineWidthFor(6, { width: 400, height: 300 })).toBe(3);
    expect(lineWidthFor(3, { width: 100, height: 75 })).toBe(1);
  });
});

describe('floodFillPixels', () => {
  /** 10x10 white image with a black square outline from (2,2) to (7,7). */
  function boxImage(): Uint8ClampedArray {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(255);
    for (let y = 2; y <= 7; y++) {
      for (let x = 2; x <= 7; x++) {
        if (x === 2 || x === 7 || y === 2 || y === 7) {
          const i = (y * 10 + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
    return data;
  }
  const at = (d: Uint8ClampedArray, x: number, y: number) => Array.from(d.slice((y * 10 + x) * 4, (y * 10 + x) * 4 + 3));

  it('fills inside a closed outline without leaking outside', () => {
    const data = boxImage();
    const filled = floodFillPixels(data, 10, 10, 4, 4, [250, 204, 21]);
    expect(filled).toBe(16); // 4x4 interior
    expect(at(data, 4, 4)).toEqual([250, 204, 21]);
    expect(at(data, 0, 0)).toEqual([255, 255, 255]); // outside untouched
  });

  it('does nothing when the area already has that colour', () => {
    const data = boxImage();
    expect(floodFillPixels(data, 10, 10, 0, 0, [255, 255, 255])).toBe(0);
  });

  it('parses palette colours', () => {
    expect(hexToRgb('#facc15')).toEqual([250, 204, 21]);
  });
});
