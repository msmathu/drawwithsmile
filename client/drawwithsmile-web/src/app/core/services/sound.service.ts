import { Injectable, inject } from '@angular/core';
import { PreferencesService } from './preferences.service';

type Cue = 'correct' | 'yourTurn' | 'tick' | 'join' | 'roundEnd';

const CUES: Record<Cue, [frequency: number, durationMs: number][]> = {
  correct: [[660, 90], [880, 140]],
  yourTurn: [[523, 90], [659, 90], [784, 160]],
  tick: [[1000, 40]],
  join: [[440, 70], [560, 90]],
  roundEnd: [[600, 120], [450, 180]],
};

/** Tiny synthesized sound effects (Web Audio API) — no audio files needed. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly prefs = inject(PreferencesService);
  private context: AudioContext | null = null;

  play(cue: Cue): void {
    if (!this.prefs.sound()) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      let at = this.context.currentTime;
      for (const [frequency, duration] of CUES[cue]) {
        const osc = this.context.createOscillator();
        const gain = this.context.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration / 1000);
        osc.connect(gain).connect(this.context.destination);
        osc.start(at);
        osc.stop(at + duration / 1000 + 0.02);
        at += duration / 1000;
      }
    } catch {
      /* audio not available */
    }
  }
}
