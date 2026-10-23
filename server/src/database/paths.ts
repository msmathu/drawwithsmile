import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Finds the server package root (the folder containing `migrations/`), whether
 * running from `src/` with tsx or from compiled `dist/src/`.
 */
export function serverRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'migrations')) && existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('Could not locate the server root (migrations folder not found).');
}

export function migrationsDir(): string {
  return join(serverRoot(), 'migrations');
}
