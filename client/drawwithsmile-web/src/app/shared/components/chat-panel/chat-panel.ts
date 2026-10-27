import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  afterRenderEffect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LIMITS, type ChatMessage } from '@dws/shared';

/**
 * Chat and guesses. All user text is rendered with interpolation, which Angular
 * escapes, so messages can never inject HTML.
 */
@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-label="Chat">
      <ol class="log" #log aria-live="polite" aria-relevant="additions">
        @for (m of messages(); track m.id) {
          <li [class]="'msg ' + m.kind">
            @if (m.nickname) {
              <strong>{{ m.nickname }}:</strong>
            }
            {{ m.text }}
          </li>
        } @empty {
          <li class="msg system">Say hi! 👋</li>
        }
      </ol>
      <form class="composer" (submit)="submit($event, box)">
        <label class="sr-only" for="chat-input">{{ placeholder() }}</label>
        <input #box id="chat-input" class="input" autocomplete="off" enterkeyhint="send" [attr.maxlength]="maxLength"
          [placeholder]="placeholder()" [value]="draft()" (input)="draft.set($any($event.target).value)"
          [disabled]="disabled()" />
        <button type="submit" class="btn btn-secondary" [disabled]="disabled() || !draft().trim()">Send</button>
      </form>
    </section>
  `,
  styles: `
    :host { display: flex; min-height: 0; }
    .panel {
      flex: 1; display: flex; flex-direction: column; min-height: 0; background: #fff;
      border: 2px solid var(--ink); border-radius: var(--radius); box-shadow: var(--shadow-sm); overflow: hidden;
    }
    .log { flex: 1; overflow-y: auto; margin: 0; padding: 8px 10px; list-style: none; min-height: 60px; overscroll-behavior: contain; }
    .msg { padding: 3px 6px; border-radius: 8px; overflow-wrap: anywhere; font-size: 0.95rem; }
    .msg + .msg { margin-top: 2px; }
    .system { color: var(--ink-soft); font-style: italic; font-size: 0.88rem; }
    .correct { background: #d8f7e6; color: #0f6b40; font-weight: 700; }
    .close { background: #fff1c2; font-weight: 700; }
    .warning { background: #ffe1e1; color: #a1262a; font-weight: 600; }
    .guessed-chat { color: #0f6b40; }
    .composer { display: flex; gap: 8px; padding: 8px; border-top: 2px solid var(--line); }
    .composer .input { min-height: 42px; min-width: 0; }
    @media (max-width: 600px) {
      .log { padding: 6px 8px; }
      .msg { font-size: 0.85rem; padding: 2px 4px; }
      .composer { padding: 6px; gap: 6px; }
      .composer .input { min-height: 38px; padding: 6px 10px; font-size: 16px; }
      .composer .btn { min-height: 38px; padding: 4px 10px; }
    }
  `,
})
export class ChatPanel {
  readonly messages = input.required<ChatMessage[]>();
  readonly placeholder = input('Type a message…');
  readonly disabled = input(false);
  readonly send = output<string>();

  protected readonly maxLength = LIMITS.CHAT_MAX;
  protected readonly draft = signal('');
  private readonly log = viewChild.required<ElementRef<HTMLOListElement>>('log');

  constructor() {
    // Keep the newest message in view when new ones arrive.
    afterRenderEffect(() => {
      this.messages();
      const el = this.log().nativeElement;
      el.scrollTop = el.scrollHeight;
    });
  }

  protected submit(event: Event, box: HTMLInputElement): void {
    event.preventDefault();
    const text = this.draft().trim();
    if (!text) return;
    this.send.emit(text);
    this.draft.set('');
    box.value = '';
    box.focus();
  }
}
