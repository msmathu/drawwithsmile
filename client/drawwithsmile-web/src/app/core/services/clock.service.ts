import { Injectable, signal } from '@angular/core';

/** A shared, low-frequency "now" signal for countdowns. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly now = signal(Date.now());

  constructor() {
    setInterval(() => this.now.set(Date.now()), 250);
  }

  /** Whole seconds left until a local deadline (never negative). */
  secondsUntil(deadline: number | null): number | null {
    // Reading now() keeps this reactive; Date.now() avoids showing one second too many between ticks.
    const now = Math.max(this.now(), Date.now());
    return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
  }
}
