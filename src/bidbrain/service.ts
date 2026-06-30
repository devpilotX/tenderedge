import { withSystem, withTenant } from '../db/pool.js';
import { getTier, type SubscriptionTierName } from '../config/platform.js';
import { NotEntitledError, NotFoundError } from '../core/errors.js';
import { getTender } from '../db/repositories/tenders.js';
import { insertHistoricalRecord, listAwardedPrices } from '../db/repositories/historical.js';
import { upsertPrediction } from '../db/repositories/predictions.js';
import { computePrediction, type PredictionResult } from './predict.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'bid-brain' });

/**
 * Records a Historical_Tender_Record when a tender closes with (optionally) an
 * awarded price (REQ 6.1–6.4). Zero/missing prices are stored as unknown. System
 * context (historical data is global training data).
 */
export async function recordOutcome(params: {
  productCategory: string | null;
  region: string | null;
  sourcePortal: string | null;
  sourceIdentifier: string | null;
  awardedPrice: number | null;
  closedAt?: string;
  attributes?: Record<string, unknown>;
}): Promise<void> {
  await withSystem((client) =>
    insertHistoricalRecord(client, {
      productCategory: params.productCategory,
      region: params.region,
      sourcePortal: params.sourcePortal,
      sourceIdentifier: params.sourceIdentifier,
      awardedPrice: params.awardedPrice,
      attributes: params.attributes,
      closedAt: params.closedAt ?? new Date().toISOString(),
    }),
  );
}

export type PredictionResponse =
  | { status: 'ok'; lower: number; upper: number; confidence: number; sampleSize: number }
  | { status: 'insufficient_data'; sampleSize: number };

/**
 * Produces a Price_Range_Prediction for a tender on behalf of an entitled account
 * (REQ 7.1–7.6). Denies non-entitled tiers with an upgrade message (ERR3, REQ 7.2).
 * Uses historical records matching the tender's category + region; returns
 * insufficient-data below the minimum sample. Successful predictions are persisted
 * per account.
 */
export async function predict(params: {
  accountId: string;
  tier: SubscriptionTierName;
  sourcePortal: string;
  sourceIdentifier: string;
}): Promise<PredictionResponse> {
  if (!getTier(params.tier).bidBrainEnabled) {
    throw new NotEntitledError('Bid Brain');
  }

  const tender = await withSystem((c) => getTender(c, params.sourcePortal, params.sourceIdentifier));
  if (!tender) throw new NotFoundError('Tender');

  const prices = await withSystem((c) =>
    listAwardedPrices(c, tender.product_category, tender.region),
  );
  const result: PredictionResult = computePrediction(prices);

  if (result.status === 'insufficient_data') {
    return { status: 'insufficient_data', sampleSize: result.sampleSize };
  }

  await withTenant(params.accountId, (c) =>
    upsertPrediction(c, {
      businessAccountId: params.accountId,
      sourcePortal: params.sourcePortal,
      sourceIdentifier: params.sourceIdentifier,
      lowerBound: result.lower,
      upperBound: result.upper,
      confidence: result.confidence,
      sampleSize: result.sampleSize,
    }),
  );
  log.debug(
    { account: params.accountId, tender: params.sourceIdentifier, confidence: result.confidence },
    'prediction computed',
  );
  return {
    status: 'ok',
    lower: result.lower,
    upper: result.upper,
    confidence: result.confidence,
    sampleSize: result.sampleSize,
  };
}
