import { TestBed } from '@angular/core/testing';
import { SocketService } from '../services/socket.service';
import { DRAWING_PRACTICE_MODE, DrawingService } from './drawing.service';

describe('DrawingService practice mode', () => {
  const sent: string[] = [];
  const listened: string[] = [];
  const fakeSocket = {
    send: (event: string) => sent.push(event),
    on: (event: string) => listened.push(event),
  };

  beforeEach(() => {
    sent.length = 0;
    listened.length = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: SocketService, useValue: fakeSocket },
        { provide: DRAWING_PRACTICE_MODE, useValue: true },
        DrawingService,
      ],
    });
  });

  it('draws, undoes, redoes and clears locally without contacting the server', () => {
    const drawing = TestBed.inject(DrawingService);
    expect(drawing.practice).toBe(true);
    expect(listened).toEqual([]);

    drawing.beginStroke(100, 100);
    drawing.extendStroke(500, 500);
    drawing.endStroke();
    expect(drawing.canUndo()).toBe(true);

    drawing.undo();
    expect(drawing.canUndo()).toBe(false);
    expect(drawing.canRedo()).toBe(true);
    drawing.redo();
    expect(drawing.canUndo()).toBe(true);
    drawing.clear();

    expect(sent).toEqual([]);
  });
});

describe('DrawingService chaos constraints', () => {
  const sent: { event: string; payload: unknown }[] = [];
  const fakeSocket = {
    send: (event: string, payload?: unknown) => sent.push({ event, payload }),
    on: () => undefined,
  };

  beforeEach(() => {
    sent.length = 0;
    TestBed.configureTestingModule({ providers: [{ provide: SocketService, useValue: fakeSocket }, DrawingService] });
  });

  it('mirrors input for "mirror hands"', () => {
    const drawing = TestBed.inject(DrawingService);
    drawing.setConstraints({ hideInk: false, flip: 'horizontal', palette: null, lockSize: false, oneStroke: false });
    drawing.beginStroke(1000, 2000);
    drawing.endStroke();
    const chunk = sent.find((s) => s.event === 'draw:chunk')!.payload as { points: number[] };
    expect(chunk.points.slice(0, 2)).toEqual([9000, 2000]);
  });

  it('allows only one stroke and no fill in the one-stroke challenge', () => {
    const drawing = TestBed.inject(DrawingService);
    drawing.setConstraints({ hideInk: false, flip: null, palette: null, lockSize: false, oneStroke: true });
    drawing.beginStroke(100, 100);
    drawing.endStroke();
    drawing.beginStroke(500, 500);
    drawing.endStroke();
    drawing.fillAt(10, 10);
    const ids = new Set(sent.filter((s) => s.event === 'draw:chunk').map((s) => (s.payload as { id: string }).id));
    expect(ids.size).toBe(1);
    expect(sent.some((s) => s.event === 'draw:fill')).toBe(false);
  });

  it('switches to an allowed colour for the tiny palette', () => {
    const drawing = TestBed.inject(DrawingService);
    drawing.color.set('#000000');
    drawing.setConstraints({ hideInk: false, flip: null, palette: ['#ef4444', '#22c55e'], lockSize: false, oneStroke: false });
    expect(drawing.color()).toBe('#ef4444');
  });
});
