import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Centralized, validated environment configuration.
 * All secrets are read from the environment — never hard-coded (see .env.example).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  PGHOST: z.string().default('localhost'),
  PGPORT: z.coerce.number().int().positive().default(5432),
  PGUSER: z.string().default('postgres'),
  PGPASSWORD: z.string().default(''),
  PGDATABASE: z.string().default('tenderedge'),
  PGDATABASE_TEST: z.string().default('tenderedge_test'),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  QUEUE_DRIVER: z.enum(['redis', 'memory']).default('memory'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./storage'),
  DOCUMENT_ENCRYPTION_KEY: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('ap-south-1'),
  S3_ENDPOINT: z.string().default(''),

  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  SESSION_INACTIVITY_MINUTES: z.coerce.number().int().positive().default(30),

  EMAIL_DRIVER: z.enum(['console', 'smtp', 'ses']).default('console'),
  SMS_DRIVER: z.enum(['console', 'twilio']).default('console'),
  EMAIL_FROM: z.string().default('alerts@tenderedge.example'),

  BILLING_DRIVER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().default(''),

  RADAR_POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  RADAR_MIN_RATE_LIMIT_RPM: z.coerce.number().int().positive().default(6),

  BACKUP_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  BACKUP_DIR: z.string().default('./backups'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: force re-read of process.env on next loadEnv() call. */
export function resetEnvCache(): void {
  cached = null;
}

export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return loadEnv()[prop as keyof Env];
  },
});
