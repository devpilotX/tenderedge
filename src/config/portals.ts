import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { env } from './env.js';

/**
 * Source_Portal configuration loader (REQ 3.1, 4.1, 4.2, 4.3).
 * A zero/negative configured rate limit is a config error and is replaced
 * with the platform minimum default (design ERR5).
 */
const PortalSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  rateLimitRpm: z.number().int(),
  publicFlag: z.boolean(),
  accessPolicyPath: z.string().default('/robots.txt'),
  pollIntervalMinutes: z.number().int().positive().optional(),
});

const PortalsFileSchema = z.object({ portals: z.array(PortalSchema) });

export interface SourcePortalConfig {
  name: string;
  baseUrl: string;
  /** Effective requests-per-minute after zero/negative fallback. */
  rateLimitRpm: number;
  publicFlag: boolean;
  accessPolicyPath: string;
  pollIntervalMinutes: number;
  /** True when the configured rate limit was invalid and replaced by the default. */
  rateLimitFallbackApplied: boolean;
}

export function normalizePortal(
  raw: z.infer<typeof PortalSchema>,
  minRateLimitRpm: number,
  defaultIntervalMinutes: number,
): SourcePortalConfig {
  const invalid = raw.rateLimitRpm <= 0;
  return {
    name: raw.name,
    baseUrl: raw.baseUrl.replace(/\/+$/, ''),
    rateLimitRpm: invalid ? minRateLimitRpm : raw.rateLimitRpm,
    publicFlag: raw.publicFlag,
    accessPolicyPath: raw.accessPolicyPath,
    pollIntervalMinutes: raw.pollIntervalMinutes ?? defaultIntervalMinutes,
    rateLimitFallbackApplied: invalid,
  };
}

export function loadPortalsConfig(filePath?: string): SourcePortalConfig[] {
  const path = resolve(filePath ?? resolve(process.cwd(), 'config', 'portals.json'));
  const parsed = PortalsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  return parsed.portals.map((p) =>
    normalizePortal(p, env.RADAR_MIN_RATE_LIMIT_RPM, env.RADAR_POLL_INTERVAL_MINUTES),
  );
}
