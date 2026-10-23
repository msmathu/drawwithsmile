type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function serialize(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    out[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
  }
  return out;
}

/** Minimal structured logger: JSON lines in production, readable lines in development. */
export function createLogger(level: Level = 'info', json = process.env['NODE_ENV'] === 'production'): Logger {
  const write = (lvl: Level, message: string, meta?: Record<string, unknown>) => {
    if (ORDER[lvl] < ORDER[level]) return;
    const data = serialize(meta);
    const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
    if (json) {
      stream.write(`${JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...data })}\n`);
    } else {
      const suffix = data ? ` ${JSON.stringify(data)}` : '';
      stream.write(`[${new Date().toISOString()}] ${lvl.toUpperCase()} ${message}${suffix}\n`);
    }
  };
  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
  };
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
