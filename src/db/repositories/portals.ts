import type { PoolClient } from 'pg';
import { withSystem } from '../pool.js';
import type { SourcePortalRow } from '../entities.js';

/**
 * Source portals are global platform config/state (not tenant-owned), so these
 * run in the system context.
 */
export interface UpsertPortalInput {
  name: string;
  baseUrl: string;
  rateLimitRpm: number;
  publicFlag: boolean;
  accessPolicy: string | null;
  pollIntervalMinutes: number;
}

export async function upsertPortal(
  client: PoolClient,
  input: UpsertPortalInput,
): Promise<SourcePortalRow> {
  const { rows } = await client.query<SourcePortalRow>(
    `INSERT INTO source_portal
       (name, base_url, rate_limit_rpm, public_flag, access_policy, poll_interval_minutes)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (name) DO UPDATE SET
       base_url = EXCLUDED.base_url,
       rate_limit_rpm = EXCLUDED.rate_limit_rpm,
       public_flag = EXCLUDED.public_flag,
       access_policy = EXCLUDED.access_policy,
       poll_interval_minutes = EXCLUDED.poll_interval_minutes
     RETURNING *`,
    [
      input.name,
      input.baseUrl,
      input.rateLimitRpm,
      input.publicFlag,
      input.accessPolicy,
      input.pollIntervalMinutes,
    ],
  );
  return rows[0]!;
}

export async function listPortals(): Promise<SourcePortalRow[]> {
  return withSystem(async (client) => {
    const { rows } = await client.query<SourcePortalRow>(
      `SELECT * FROM source_portal ORDER BY name`,
    );
    return rows;
  });
}

export async function recordPortalPollResult(
  portalName: string,
  status: 'ok' | 'failed',
  error: string | null,
): Promise<void> {
  await withSystem(async (client) => {
    await client.query(
      `UPDATE source_portal
       SET last_polled_at = now(), last_status = $2, last_error = $3
       WHERE name = $1`,
      [portalName, status, error],
    );
  });
}
