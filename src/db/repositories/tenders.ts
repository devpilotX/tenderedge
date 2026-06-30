import type { PoolClient } from 'pg';
import type { Tender } from '../entities.js';
import type { StoredTender } from '../../radar/normalize.js';

export interface UpsertResult {
  tender: Tender;
  inserted: boolean;
}

/**
 * Upserts a tender keyed on (source_portal, source_identifier) — the dedup identity
 * (INV2, REQ 3.3). On update, complete existing fields are preserved when the
 * incoming listing omits them (REQ 3.5): category/region fall back via COALESCE, and
 * estimated value / deadline are only overwritten when the incoming value is `known`.
 * A pre-existence CTE distinguishes insert from update (works on partitioned tables,
 * unlike the xmax trick). Runs in the system context.
 */
export async function upsertTender(client: PoolClient, s: StoredTender): Promise<UpsertResult> {
  const { rows } = await client.query<Tender & { inserted: boolean }>(
    `WITH existing AS (
       SELECT 1 AS hit FROM tender WHERE source_portal = $1 AND source_identifier = $2
     ), upserted AS (
       INSERT INTO tender (
         source_portal, source_identifier, title, product_category, region,
         estimated_value, estimated_value_status, deadline, deadline_status, retrieved_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_portal, source_identifier) DO UPDATE SET
         title = EXCLUDED.title,
         product_category = COALESCE(EXCLUDED.product_category, tender.product_category),
         region = COALESCE(EXCLUDED.region, tender.region),
         estimated_value = CASE WHEN EXCLUDED.estimated_value_status = 'known'
           THEN EXCLUDED.estimated_value ELSE tender.estimated_value END,
         estimated_value_status = CASE WHEN EXCLUDED.estimated_value_status = 'known'
           THEN 'known' ELSE tender.estimated_value_status END,
         deadline = CASE WHEN EXCLUDED.deadline_status = 'known'
           THEN EXCLUDED.deadline ELSE tender.deadline END,
         deadline_status = CASE WHEN EXCLUDED.deadline_status = 'known'
           THEN 'known' ELSE tender.deadline_status END,
         retrieved_at = EXCLUDED.retrieved_at,
         updated_at = now()
       RETURNING *
     )
     SELECT upserted.*, (NOT EXISTS (SELECT 1 FROM existing)) AS inserted FROM upserted`,
    [
      s.source_portal,
      s.source_identifier,
      s.title,
      s.product_category,
      s.region,
      s.estimated_value,
      s.estimated_value_status,
      s.deadline,
      s.deadline_status,
      s.retrieved_at,
    ],
  );
  const row = rows[0]!;
  const { inserted, ...tender } = row;
  return { tender: tender as Tender, inserted };
}

export async function getTender(
  client: PoolClient,
  sourcePortal: string,
  sourceIdentifier: string,
): Promise<Tender | null> {
  const { rows } = await client.query<Tender>(
    `SELECT * FROM tender WHERE source_portal = $1 AND source_identifier = $2`,
    [sourcePortal, sourceIdentifier],
  );
  return rows[0] ?? null;
}

export async function countTenders(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ c: string }>(`SELECT count(*) c FROM tender`);
  return Number(rows[0]!.c);
}

/** Marks tenders whose deadline has passed as closed; returns affected identities. */
export async function closeExpiredTenders(
  client: PoolClient,
): Promise<{ source_portal: string; source_identifier: string }[]> {
  const { rows } = await client.query<{ source_portal: string; source_identifier: string }>(
    `UPDATE tender SET status = 'closed', updated_at = now()
     WHERE status = 'open' AND deadline_status = 'known' AND deadline < now()
     RETURNING source_portal, source_identifier`,
  );
  return rows;
}
