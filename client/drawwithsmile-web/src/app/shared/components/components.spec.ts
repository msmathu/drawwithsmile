import { TestBed } from '@angular/core/testing';
import type { ChatMessage } from '@dws/shared';
import { ChatPanel } from './chat-panel/chat-panel';
import { WordHint } from './word-hint/word-hint';

describe('ChatPanel', () => {
  it('renders user text as plain text, never as HTML', async () => {
    const fixture = TestBed.createComponent(ChatPanel);
    const messages: ChatMessage[] = [
      { id: '1', kind: 'chat', nickname: 'Mallory', playerId: 'x', text: '<img src=x onerror="alert(1)">', ts: 1 },
    ];
    fixture.componentRef.setInput('messages', messages);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.log img')).toBeNull();
    expect(el.querySelector('.log')!.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('emits trimmed messages and clears the input', async () => {
    const fixture = TestBed.createComponent(ChatPanel);
    fixture.componentRef.setInput('messages', []);
    const sent: string[] = [];
    fixture.componentInstance.send.subscribe((t) => sent.push(t));
    await fixture.whenStable();
    const input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
    input.value = '  banana  ';
    input.dispatchEvent(new Event('input'));
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(sent).toEqual(['banana']);
    expect(input.value).toBe('');
  });
});

describe('WordHint', () => {
  it('shows blanks and the letter count for guessers', async () => {
    const fixture = TestBed.createComponent(WordHint);
    fixture.componentRef.setInput('hint', [null, 'a', null, ' ', null]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('.cell').length).toBe(4);
    expect(el.querySelectorAll('.cell.blank').length).toBe(3);
    expect(el.querySelector('.count')!.textContent).toBe('4');
  });

  it('splits Tamil words into whole letters for the drawer', async () => {
    const fixture = TestBed.createComponent(WordHint);
    fixture.componentRef.setInput('word', 'யானை');
    await fixture.whenStable();
    const cells = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.cell')).map((c) => c.textContent);
    expect(cells).toEqual(['யா', 'னை']);
  });
});

describe('roomStatus', () => {
  it('describes each phase like the classic room browser', async () => {
    const { roomStatus } = await import('./room-list/room-list');
    const base = { code: 'ABCDEFGH', name: 'The Kitten Room', visibility: 'public' as const, players: 2, maxPlayers: 8, language: 'en' as const, round: 2, totalRounds: 3 };
    expect(roomStatus({ ...base, phase: 'lobby' })).toBe('Waiting for players');
    expect(roomStatus({ ...base, phase: 'drawing' })).toBe('Playing round 2 of 3');
    expect(roomStatus({ ...base, phase: 'gameEnd' })).toBe('Finishing game');
  });
});

describe('rulesSummary', () => {
  it('describes custom rules for players who cannot edit them', async () => {
    const { rulesSummary } = await import('../rules');
    const { DEFAULT_SETTINGS } = await import('@dws/shared');
    const lines = rulesSummary({ ...DEFAULT_SETTINGS, mode: 'chaos', chaosRules: ['one-stroke'], teams: true, voting: true, hints: false });
    const text = lines.join('\n');
    expect(text).toContain('Chaos mode');
    expect(text).toContain('One stroke');
    expect(text).toContain('Team Battle');
    expect(text).toContain('Vote after each round');
    expect(text).toContain('no hints');
  });
});

describe('local mute', () => {
  it('hides every message from a muted player, including earlier ones, but keeps system messages', async () => {
    const { filterMuted } = await import('../../core/services/game.service');
    const messages: ChatMessage[] = [
      { id: '1', kind: 'chat', playerId: 'troll', nickname: 'Troll', text: 'rude', ts: 1 },
      { id: '2', kind: 'system', text: 'Troll joined the room.', ts: 2 },
      { id: '3', kind: 'chat', playerId: 'friend', nickname: 'Friend', text: 'hi', ts: 3 },
      { id: '4', kind: 'guessed-chat', playerId: 'troll', nickname: 'Troll', text: 'again', ts: 4 },
    ];
    expect(filterMuted(messages, new Set(['troll'])).map((m) => m.id)).toEqual(['2', '3']);
    expect(filterMuted(messages, new Set()).map((m) => m.id)).toEqual(['1', '2', '3', '4']);
  });
});
