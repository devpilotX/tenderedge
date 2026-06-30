import { MIN_HISTORICAL_RECORDS_FOR_PREDICTION } from '../config/platform.js';

export interface PredictionResult {
  status: 'ok' | 'insufficient_data';
  lower: number;
  upper: number;
  confidence: number; // [0,1]
  sampleSize: number;
}

/** Linear-interpolation percentile over an ascending-sorted array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Computes a Price_Range_Prediction from matching historical awarded prices.
 * Deterministic. Returns insufficient-data when fewer than the minimum sample
 * exists (REQ 7.5). Otherwise the likely winning range is the interquartile band
 * [p25, p75] (so lower <= upper, INV3) and confidence in [0,1] rises with sample
 * size and falls with relative spread. (REQ 7.3, 7.4, 7.6)
 */
export function computePrediction(prices: number[]): PredictionResult {
  const sampleSize = prices.length;
  if (sampleSize < MIN_HISTORICAL_RECORDS_FOR_PREDICTION) {
    return { status: 'insufficient_data', lower: 0, upper: 0, confidence: 0, sampleSize };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const lower = round2(percentile(sorted, 25));
  const upper = round2(Math.max(percentile(sorted, 75), percentile(sorted, 25)));
  const median = percentile(sorted, 50);

  const relativeSpread = median > 0 ? (upper - lower) / median : 1;
  const tightness = 1 / (1 + relativeSpread);
  const sizeFactor = Math.min(1, sampleSize / 50);
  const confidence = round3(Math.max(0, Math.min(1, sizeFactor * tightness)));

  return { status: 'ok', lower, upper, confidence, sampleSize };
}
