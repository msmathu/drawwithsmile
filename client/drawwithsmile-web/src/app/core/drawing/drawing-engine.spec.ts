import { DrawingEngine, lineWidthFor } from './drawing-engine';

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
