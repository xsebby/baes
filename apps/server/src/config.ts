import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  // postgres://user:pass@host/db for real deployments; pglite:<dir> (or pglite:memory)
  // runs an embedded Postgres for local dev with nothing installed.
  DATABASE_URL: z.string().default('pglite:.pglite/dev'),
  // HMAC/signing secret for stream URLs + token derivation. Must be long & random in prod.
  SERVER_SECRET: z.string().min(16).default('dev-secret-change-me-in-prod'),
  SESSION_TTL_DAYS: z.coerce.number().default(30),
  INVITE_TTL_HOURS: z.coerce.number().default(72),
  // Extracted cover art and other server-generated files live here.
  DATA_DIR: z.string().default('.data'),
  // Built web client directory; served at / when it exists.
  WEB_DIST: z.string().default('public'),
  // Lifetime of signed stream/art URLs. Must comfortably outlast the longest
  // track — AVPlayer keeps range-requesting the same URL for the whole play.
  MEDIA_URL_TTL_SECONDS: z.coerce.number().default(3600),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.SERVER_SECRET.startsWith('dev-secret')) {
    throw new Error('SERVER_SECRET must be set to a strong random value in production');
  }
  return parsed.data;
}
