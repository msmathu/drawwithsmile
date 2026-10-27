import { z } from 'zod';

const boolean = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Comma separated list of allowed browser origins. */
  CLIENT_ORIGINS: z.string().default('http://localhost:4200'),
  /** HMAC secret for guest session tokens. Required in production. */
  SESSION_SECRET: z.string().optional(),
  /** Number of reverse proxies in front of the app (Render = 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** postgres = use DATABASE_URL, pglite = embedded Postgres on disk, memory = embedded Postgres in RAM. */
  DB_MODE: z.enum(['postgres', 'pglite', 'memory']).optional(),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify']).default('require'),
  /** Optional PEM CA certificate (e.g. Supabase's) used with DATABASE_SSL=verify. */
  DATABASE_CA_CERT: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  PGLITE_DIR: z.string().default('.data/pglite'),
  RUN_MIGRATIONS_ON_START: boolean.default(true),
  /** Optional path to the built Angular app, to serve client and API from one origin. */
  SERVE_CLIENT_DIR: z.string().optional(),
  MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(50),
  /** Burst of create/join/quick-play actions allowed per IP (shared NATs: schools, offices). */
  ROOM_ACTION_BURST: z.coerce.number().int().min(1).max(1000).default(20),
  /** A player reported by MORE than this many different players is banned permanently. */
  AUTO_BAN_REPORTS: z.coerce.number().int().min(1).max(1000).default(10),
});

export interface AppConfig {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  clientOrigins: string[];
  sessionSecret: string;
  trustProxy: number;
  db: {
    mode: 'postgres' | 'pglite' | 'memory';
    url?: string;
    ssl: 'disable' | 'require' | 'verify';
    caCert?: string;
    poolMax: number;
    pgliteDir: string;
    runMigrationsOnStart: boolean;
  };
  serveClientDir?: string;
  maxConnectionsPerIp: number;
  roomActionBurst: number;
  autoBanReports: number;
}

const DEV_SECRET = 'dev-only-insecure-secret-change-me';

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;

  if (e.NODE_ENV === 'production' && (!e.SESSION_SECRET || e.SESSION_SECRET.length < 32)) {
    throw new Error('SESSION_SECRET must be set to at least 32 random characters in production.');
  }

  const mode = e.DB_MODE ?? (e.DATABASE_URL ? 'postgres' : e.NODE_ENV === 'test' ? 'memory' : 'pglite');
  if (mode === 'postgres' && !e.DATABASE_URL) {
    throw new Error('DB_MODE=postgres requires DATABASE_URL.');
  }

  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    // Render sets RENDER_EXTERNAL_URL (e.g. https://drawwithsmile.onrender.com); when the server
    // also serves the website, that address must be allowed without any manual setup.
    clientOrigins: [...e.CLIENT_ORIGINS.split(','), source['RENDER_EXTERNAL_URL'] ?? '']
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o, i, all) => o !== '' && all.indexOf(o) === i),
    sessionSecret: e.SESSION_SECRET ?? DEV_SECRET,
    trustProxy: e.TRUST_PROXY,
    db: {
      mode,
      url: e.DATABASE_URL,
      ssl: e.DATABASE_SSL,
      caCert: e.DATABASE_CA_CERT?.replace(/\\n/g, '\n'),
      poolMax: e.DATABASE_POOL_MAX,
      pgliteDir: e.PGLITE_DIR,
      runMigrationsOnStart: e.RUN_MIGRATIONS_ON_START,
    },
    serveClientDir: e.SERVE_CLIENT_DIR,
    maxConnectionsPerIp: e.MAX_CONNECTIONS_PER_IP,
    roomActionBurst: e.ROOM_ACTION_BURST,
    autoBanReports: e.AUTO_BAN_REPORTS,
  };
}

export function usesDevSecret(config: AppConfig): boolean {
  return config.sessionSecret === DEV_SECRET;
}
