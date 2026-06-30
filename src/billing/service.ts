import { withSystem, withTenant } from '../db/pool.js';
import { assertOwner } from '../auth/rbac.js';
import {
  BILLING_MAX_RETRIES,
  BILLING_RETRY_WINDOW_DAYS,
  getTier,
  TIERS,
  type SubscriptionTierName,
} from '../config/platform.js';
import { TierLimitError, NotFoundError } from '../core/errors.js';
import type { Subscription, UserRole } from '../db/entities.js';
import { setAccountStatus, setAccountTier } from '../db/repositories/accounts.js';
import { upsertMatchFilter } from '../db/repositories/match-filters.js';
import { notifyAccount } from '../notifications/notify.js';
import { getBillingProvider } from './providers.js';
import {
  applyPendingTier,
  createSubscription,
  getSubscription,
  incrementRetry,
  listDueSubscriptions,
  recordSuccessfulCharge,
  setPendingTier,
  setSubscriptionStatus,
} from '../db/repositories/subscriptions.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'billing' });
const DAY_MS = 86_400_000;

function periodEndFrom(nowMs: number): string {
  return new Date(nowMs + 30 * DAY_MS).toISOString();
}

async function regionCount(accountId: string): Promise<{ regions: string[] }> {
  return withSystem(async (c) => {
    const { rows } = await c.query<{ regions: string[] }>(
      `SELECT regions FROM match_filter WHERE business_account_id = $1`,
      [accountId],
    );
    return { regions: rows[0]?.regions ?? [] };
  });
}

/** Subscribes an account to a tier and grants its entitlements (REQ 13.1, 13.2). Owner-only. */
export async function subscribe(
  accountId: string,
  role: UserRole,
  tier: SubscriptionTierName,
  nowMs: number = Date.now(),
): Promise<Subscription> {
  assertOwner(role);
  return withSystem(async (c) => {
    const sub = await createSubscription(c, accountId, tier, periodEndFrom(nowMs));
    await setAccountTier(c, accountId, tier);
    await setAccountStatus(c, accountId, 'active');
    return sub;
  });
}

export interface ChangeTierResult {
  needsRegionSelection: boolean;
  pendingTier?: SubscriptionTierName;
  currentRegions?: string[];
  allowedRegions?: number;
}

/**
 * Requests a tier change applied at the next billing cycle (REQ 13.6). If a downgrade
 * would exceed the new tier's region limit, returns a prompt to select which regions
 * to keep instead of applying (REQ 13.7). Owner-only.
 */
export async function changeTier(
  accountId: string,
  role: UserRole,
  newTier: SubscriptionTierName,
): Promise<ChangeTierResult> {
  assertOwner(role);
  const max = getTier(newTier).maxRegions;
  const { regions } = await regionCount(accountId);
  if (regions.length > max) {
    return { needsRegionSelection: true, currentRegions: regions, allowedRegions: max };
  }
  await withSystem((c) => setPendingTier(c, accountId, newTier));
  return { needsRegionSelection: false, pendingTier: newTier };
}

/**
 * Completes a downgrade by trimming regions to the new tier limit, then schedules the
 * tier change for the next cycle (REQ 13.7). Owner-only.
 */
export async function selectRegionsForDowngrade(
  accountId: string,
  role: UserRole,
  newTier: SubscriptionTierName,
  regionsToKeep: string[],
): Promise<void> {
  assertOwner(role);
  const max = getTier(newTier).maxRegions;
  if (regionsToKeep.length > max) {
    throw new TierLimitError(`The ${newTier} plan allows up to ${max} regions.`);
  }
  await withTenant(accountId, async (c) => {
    const { rows } = await c.query<{ product_categories: string[]; min_value: string | null; max_value: string | null }>(
      `SELECT product_categories, min_value, max_value FROM match_filter WHERE business_account_id = $1`,
      [accountId],
    );
    const existing = rows[0];
    await upsertMatchFilter(c, accountId, {
      regions: regionsToKeep,
      productCategories: existing?.product_categories ?? [],
      minValue: existing?.min_value == null ? null : Number(existing.min_value),
      maxValue: existing?.max_value == null ? null : Number(existing.max_value),
    });
  });
  await withSystem((c) => setPendingTier(c, accountId, newTier));
}

export interface BillingCycleOutcome {
  charged: boolean;
  status: 'active' | 'past_due' | 'read_only';
  retryCount: number;
}

/**
 * Runs one billing attempt for an account (REQ 13.3–13.6). On success: applies any
 * pending tier change, rolls the period, and reactivates. On failure: increments the
 * retry count and notifies; once retries reach the cap within the window, restricts
 * the account to read-only (REQ 13.4, 13.5).
 */
export async function runBillingCycle(
  accountId: string,
  nowMs: number = Date.now(),
): Promise<BillingCycleOutcome> {
  const sub = await withSystem((c) => getSubscription(c, accountId));
  if (!sub) throw new NotFoundError('Subscription');

  const amount = TIERS[sub.tier].monthlyPricePaise;
  const period = new Date(sub.current_period_end).toISOString();
  const result = await getBillingProvider().charge({
    accountId,
    amountPaise: amount,
    idempotencyKey: `${accountId}:${period}:${sub.retry_count}`,
  });

  if (result.success) {
    return withSystem(async (c) => {
      const newTier = await applyPendingTier(c, accountId);
      if (newTier) await setAccountTier(c, accountId, newTier);
      await recordSuccessfulCharge(c, accountId, periodEndFrom(nowMs));
      await setAccountStatus(c, accountId, 'active');
      log.info({ account: accountId, tier: newTier ?? sub.tier }, 'billing charge succeeded');
      return { charged: true, status: 'active' as const, retryCount: 0 };
    });
  }

  return withSystem(async (c) => {
    const retryCount = await incrementRetry(c, accountId);
    await notifyAccount(c, {
      accountId,
      type: 'billing_failed',
      dedupeKey: `billing-fail:${period}:${retryCount}`,
      payload: { amountPaise: amount, attempt: retryCount, reason: result.reason ?? 'charge failed' },
    });
    if (retryCount >= BILLING_MAX_RETRIES) {
      await setSubscriptionStatus(c, accountId, 'read_only');
      await setAccountStatus(c, accountId, 'read_only');
      log.warn({ account: accountId, retryCount, windowDays: BILLING_RETRY_WINDOW_DAYS }, 'account restricted to read-only (unpaid)');
      return { charged: false, status: 'read_only' as const, retryCount };
    }
    return { charged: false, status: 'past_due' as const, retryCount };
  });
}

/** Runs billing for all due subscriptions (scheduled). Failures are isolated per account. */
export async function runDueBillingCycles(nowMs: number = Date.now()): Promise<number> {
  const due = await withSystem((c) => listDueSubscriptions(c, new Date(nowMs).toISOString()));
  let processed = 0;
  for (const sub of due) {
    try {
      await runBillingCycle(sub.business_account_id, nowMs);
      processed += 1;
    } catch (err) {
      log.error({ account: sub.business_account_id, err }, 'billing cycle failed for account');
    }
  }
  return processed;
}

export async function getAccountSubscription(accountId: string): Promise<Subscription | null> {
  return withTenant(accountId, (c) => getSubscription(c, accountId));
}
