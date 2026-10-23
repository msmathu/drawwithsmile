import { Injectable } from '@angular/core';

/** localStorage that never throws (private mode, blocked storage, SSR). */
@Injectable({ providedIn: 'root' })
export class StorageService {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* storage unavailable: keep working without persistence */
    }
  }

  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
