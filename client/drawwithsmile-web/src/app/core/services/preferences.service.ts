import { Injectable, inject, signal } from '@angular/core';
import type { Language } from '@dws/shared';
import { StorageService } from './storage.service';

const ADJECTIVES = ['Happy', 'Sunny', 'Jolly', 'Brave', 'Clever', 'Swift', 'Cosmic', 'Lucky', 'Bubbly', 'Zippy', 'Cheery', 'Mighty'];
const NOUNS = ['Panda', 'Pencil', 'Mango', 'Tiger', 'Comet', 'Doodle', 'Koala', 'Rocket', 'Parrot', 'Crayon', 'Otter', 'Pixel'];

export function randomNickname(): string {
  const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)]!;
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

/** Player preferences kept on this device only. */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  private readonly storage = inject(StorageService);

  readonly nickname = signal(this.storage.get('dws.nickname') ?? '');
  readonly language = signal<Language>(this.storage.get('dws.language') === 'ta' ? 'ta' : 'en');
  readonly sound = signal(this.storage.get('dws.sound') !== 'off');

  setNickname(value: string): void {
    this.nickname.set(value);
    this.storage.set('dws.nickname', value);
  }

  setLanguage(value: Language): void {
    this.language.set(value);
    this.storage.set('dws.language', value);
  }

  setSound(on: boolean): void {
    this.sound.set(on);
    this.storage.set('dws.sound', on ? 'on' : 'off');
  }
}
