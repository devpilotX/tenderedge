import type { PoolClient } from 'pg';
import type { MatchFilter } from '../entities.js';

/**
 * Per-account Smart Match filter configuration (REQ 5.1). One row per account
 * (UNIQUE business_account_id), upserted. Tenant-scoped via withTenant().
 */
export interface MatchFilterInput {
  regions: string[];
  productCategories: string[];
  minValue: number | null;
  maxValue: number | null;
}

export async function upsertMatchFilter(
  client: PoolClient,
  businessAccountId: string,
  input: MatchFilterInput,
): Promise<MatchFilter> {
  const { rows } = await client.query<MatchFilter>(
    `INSERT INTO match_filter (business_account_id, regions, product_categories, min_value, max_value)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (business_account_id) DO UPDATE SET
       regions = EXCLUDED.regions,
       product_categories = EXCLUDED.product_categories,
       min_value = EXCLUDED.min_value,
       max_value = EXCLUDED.max_value,
       updated_at = now()
     RETURNING *`,
    [
      businessAccountId,
      input.regions,
      input.productCategories,
      input.minValue,
      input.maxValue,
    ],
  );
  return rows[0]!;
}

export async function getMatchFilter(
  client: PoolClient,
  businessAccountId: string,
): Promise<MatchFilter | null> {
  const { rows } = await client.query<MatchFilter>(
    `SELECT * FROM match_filter WHERE business_account_id = $1`,
    [businessAccountId],
  );
  return rows[0] ?? null;
}

/** System-context: all configured filters (used by Smart Match evaluation over a new tender). */
export async function listAllMatchFilters(client: PoolClient): Promise<MatchFilter[]> {
  const { rows } = await client.query<MatchFilter>(`SELECT * FROM match_filter`);
  return rows;
}
