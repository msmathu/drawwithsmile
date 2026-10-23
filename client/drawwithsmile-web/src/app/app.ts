import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { SocketService } from './core/services/socket.service';
import { ToastService } from './core/services/toast.service';
import { Logo } from './shared/components/logo/logo';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, Logo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="topbar">
      <a routerLink="/" class="brand" aria-label="DrawWithSmile home"><app-logo [compact]="true" /></a>
      @switch (socket.status()) {
        @case ('connected') {
          <span class="status ok" title="Connected"><span class="dot"></span><span class="label">Online</span></span>
        }
        @case ('reconnecting') {
          <span class="status warn" role="status"><span class="dot"></span>Reconnecting…</span>
        }
        @case ('connecting') {
          <span class="status warn" role="status"><span class="dot"></span>Connecting…</span>
        }
      }
    </header>
    <main><router-outlet /></main>
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <button type="button" class="toast" [class]="'toast ' + t.kind" (click)="toast.dismiss(t.id)">{{ t.text }}</button>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 100dvh; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; padding-top: max(8px, env(safe-area-inset-top));
    }
    .brand { text-decoration: none; }
    main { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .status { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; font-weight: 700; }
    .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--ink); }
    .ok .dot { background: var(--success); }
    .warn .dot { background: var(--sun); animation: pulse 1s infinite alternate; }
    @keyframes pulse { to { opacity: 0.3; } }
    @media (max-width: 480px) { .ok .label { display: none; } }
    .toasts {
      position: fixed; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%);
      display: flex; flex-direction: column; gap: 8px; z-index: 100; width: min(92vw, 420px);
    }
    .toast {
      border: 2px solid var(--ink); border-radius: 14px; padding: 10px 14px; background: #fff;
      box-shadow: var(--shadow-sm); font-weight: 600; text-align: left; cursor: pointer;
    }
    .toast.error { background: #ffe1e1; }
    .toast.success { background: #d8f7e6; }
  `,
})
export class App {
  protected readonly socket = inject(SocketService);
  protected readonly toast = inject(ToastService);
}
