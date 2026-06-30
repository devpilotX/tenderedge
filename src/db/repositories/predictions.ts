import type { PoolClient } from 'pg';
import type { PricePrediction } from '../entities.js';

/**
 * Per-account Price_Range_Prediction store (REQ 7). The table enforces
 * lower_bound <= upper_bound and confidence in [0,1] (INV3). Tenant-scoped.
 */
export interface UpsertPredictionInput {
  businessAccountId: string;
  sourcePortal: string;
  sourceIdentifier: string;
  lowerBound: number;
  upperBound: number;
  confidence: number;
  sampleSize: number;
}

export async function upsertPrediction(
  client: PoolClient,
  input: UpsertPredictionInput,
): Promise<PricePrediction> {
  const { rows } = await client.query<PricePrediction>(
    `INSERT INTO price_prediction
       (business_account_id, tender_source_portal, tender_source_identifier,
        lower_bound, upper_bound, confidence, sample_size)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (business_account_id, tender_source_portal, tender_source_identifier)
       DO UPDATE SET lower_bound = EXCLUDED.lower_bound,
                     upper_bound = EXCLUDED.upper_bound,
                     confidence = EXCLUDED.confidence,
                     sample_size = EXCLUDED.sample_size,
                     computed_at = now()
     RETURNING *`,
    [
      input.businessAccountId,
      input.sourcePortal,
      input.sourceIdentifier,
      input.lowerBound.toFixed(2),
      input.upperBound.toFixed(2),
      input.confidence.toFixed(3),
      input.sampleSize,
    ],
  );
  return rows[0]!;
}

export async function getPrediction(
  client: PoolClient,
  sourcePortal: string,
  sourceIdentifier: string,
): Promise<PricePrediction | null> {
  const { rows } = await client.query<PricePrediction>(
    `SELECT * FROM price_prediction
     WHERE tender_source_portal = $1 AND tender_source_identifier = $2`,
    [sourcePortal, sourceIdentifier],
  );
  return rows[0] ?? null;
}
