import type { TierDefinition } from '../config/platform.js';

/** The tender attributes Smart Match scores against. */
export interface ScorableTender {
  region: string | null;
  productCategory: string | null;
  estimatedValue: number | null;
  estimatedValueStatus: 'known' | 'unknown';
  deadline: string | null;
  deadlineStatus: 'known' | 'unknown';
  status: 'open' | 'closed';
}

export interface ScorableFilter {
  regions: string[];
  productCategories: string[];
  minValue: number | null;
  maxValue: number | null;
}

export interface MatchEvaluation {
  eligible: boolean;
  score: number; // 0..100, only meaningful when eligible
}

const DAY_MS = 86_400_000;

// Component weights sum to 100 (INV4: score always within [0,100]).
const W_REGION = 30;
const W_CATEGORY = 30;
const W_VALUE = 25;
const W_DEADLINE = 15;

/**
 * The Regions an account may actually track on its tier: the configured regions
 * truncated to the tier's region cap. Regions beyond the cap are never considered,
 * so adding such a Region cannot increase the match count (MM1, REQ 5.5, 14).
 */
export function permittedRegions(filter: ScorableFilter, tier: TierDefinition): string[] {
  return filter.regions.slice(0, tier.maxRegions);
}

function valueScore(t: ScorableTender, f: ScorableFilter): number {
  if (t.estimatedValueStatus !== 'known' || t.estimatedValue === null) return 0.48 * W_VALUE;
  const lo = f.minValue;
  const hi = f.maxValue;
  if (lo !== null && hi !== null && hi > lo) {
    const mid = (lo + hi) / 2;
    const half = (hi - lo) / 2;
    const closeness = Math.max(0, 1 - Math.abs(t.estimatedValue - mid) / half);
    return 0.52 * W_VALUE + 0.48 * W_VALUE * closeness;
  }
  return 0.76 * W_VALUE; // open-ended range: neutral-high
}

function deadlineScore(t: ScorableTender, nowMs: number): number {
  if (t.deadlineStatus !== 'known' || !t.deadline) return 0.47 * W_DEADLINE;
  const days = Math.floor((Date.parse(t.deadline) - nowMs) / DAY_MS);
  if (days >= 14) return W_DEADLINE;
  return 0.53 * W_DEADLINE + (0.47 * W_DEADLINE * Math.max(0, days)) / 14;
}

/**
 * Deterministically evaluates a tender against an account's filter + tier.
 * Eligibility (REQ 5.2, 5.5, 5.6): open status, deadline not passed, region within
 * the tier-permitted set, category in the filter (when constrained), and a known
 * value within [min,max]. Score (REQ 5.3) is a weighted blend in [0,100].
 * Pure and deterministic given `nowMs` — re-evaluating an unchanged tender yields
 * the same result (ID2).
 */
export function evaluateMatch(
  tender: ScorableTender,
  filter: ScorableFilter,
  tier: TierDefinition,
  nowMs: number,
): MatchEvaluation {
  if (tender.status === 'closed') return { eligible: false, score: 0 };
  if (tender.deadlineStatus === 'known' && tender.deadline && Date.parse(tender.deadline) < nowMs) {
    return { eligible: false, score: 0 };
  }

  const regions = permittedRegions(filter, tier);
  if (!tender.region || !regions.includes(tender.region)) return { eligible: false, score: 0 };

  const categoryConstrained = filter.productCategories.length > 0;
  if (categoryConstrained && (!tender.productCategory || !filter.productCategories.includes(tender.productCategory))) {
    return { eligible: false, score: 0 };
  }

  if (tender.estimatedValueStatus === 'known' && tender.estimatedValue !== null) {
    if (filter.minValue !== null && tender.estimatedValue < filter.minValue) {
      return { eligible: false, score: 0 };
    }
    if (filter.maxValue !== null && tender.estimatedValue > filter.maxValue) {
      return { eligible: false, score: 0 };
    }
  }

  const categoryScore = categoryConstrained ? W_CATEGORY : 0.5 * W_CATEGORY;
  const raw = W_REGION + categoryScore + valueScore(tender, filter) + deadlineScore(tender, nowMs);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  return { eligible: true, score };
}
