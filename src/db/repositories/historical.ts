import type { PoolClient } from 'pg';
import { withSystem } from '../pool.js';
import type { HistoricalTenderRecord } from '../entities.js';

/**
 * Historical_Tender_Record store (REQ 6). Global (not tenant-scoped) — used to train
 * Bid Brain. Retained 5+ years via the partitioned table; zero/missing awarded prices
 * are marked unknown (REQ 6.4).
 */
export interface InsertHistoricalInput {
  productCategory: string | null;
  region: string | null;
  sourcePortal: string | null;
  sourceIdentifier: string | null;
  awardedPrice: number | null;
  attributes?: Record<string, unknown>;
  closedAt: string; // ISO
}

export async function insertHistoricalRecord(
  client: PoolClient,
  input: InsertHistoricalInput,
): Promise<HistoricalTenderRecord> {
  const hasPrice = input.awardedPrice !== null && input.awardedPrice > 0;
  const { rows } = await client.query<HistoricalTenderRecord>(
    `INSERT INTO historical_tender_record
       (product_category, region, source_portal, source_identifier,
        attributes_json, awarded_price, awarded_price_status, closed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      input.productCategory,
      input.region,
      input.sourcePortal,
      input.sourceIdentifier,
      JSON.stringify(input.attributes ?? {}),
      hasPrice ? input.awardedPrice : null,
      hasPrice ? 'known' : 'unknown',
      input.closedAt,
    ],
  );
  return rows[0]!;
}

/**
 * Returns known awarded prices for records matching a tender's category + region,
 * ordered ascending — the sample Bid Brain predicts from (REQ 7.4).
 */
export async function listAwardedPrices(
  client: PoolClient,
  productCategory: string | null,
  region: string | null,
): Promise<number[]> {
  const { rows } = await client.query<{ awarded_price: string }>(
    `SELECT awarded_price FROM historical_tender_record
     WHERE awarded_price_status = 'known'
       AND awarded_price IS NOT NULL
       AND product_category IS NOT DISTINCT FROM $1
       AND region IS NOT DISTINCT FROM $2
     ORDER BY awarded_price ASC`,
    [productCategory, region],
  );
  return rows.map((r) => Number(r.awarded_price));
}

export async function countHistoricalForSystem(): Promise<number> {
  return withSystem(async (client) => {
    const { rows } = await client.query<{ c: string }>(
      `SELECT count(*) c FROM historical_tender_record`,
    );
    return Number(rows[0]!.c);
  });
}
