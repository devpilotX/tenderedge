import type { PoolClient } from 'pg';
import type { Subscription, SubscriptionStatus, SubscriptionTierName } from '../entities.js';

/**
 * Subscription/billing repository (REQ 13). One subscription row per account. Most
 * operations run in the system context (billing cycles are platform-driven); reads
 * for the owning account run tenant-scoped.
 */
export async function getSubscription(
  client: PoolClient,
  accountId: string,
): Promise<Subscription | null> {
  const { rows } = await client.query<Subscription>(
    `SELECT * FROM subscription WHERE business_account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** Creates (or returns existing) subscription for an account at the given tier. */
export async function createSubscription(
  client: PoolClient,
  accountId: string,
  tier: SubscriptionTierName,
  periodEnd: string,
): Promise<Subscription> {
  const { rows } = await client.query<Subscription>(
    `INSERT INTO subscription (business_account_id, tier, status, current_period_end)
     VALUES ($1, $2, 'active', $3)
     ON CONFLICT (business_account_id) DO UPDATE SET tier = EXCLUDED.tier, status = 'active', updated_at = now()
     RETURNING *`,
    [accountId, tier, periodEnd],
  );
  return rows[0]!;
}

export async function setSubscriptionStatus(
  client: PoolClient,
  accountId: string,
  status: SubscriptionStatus,
): Promise<void> {
  await client.query(
    `UPDATE subscription SET status = $2, updated_at = now() WHERE business_account_id = $1`,
    [accountId, status],
  );
}

export async function setPendingTier(
  client: PoolClient,
  accountId: string,
  pendingTier: SubscriptionTierName | null,
): Promise<void> {
  await client.query(
    `UPDATE subscription SET pending_tier = $2, updated_at = now() WHERE business_account_id = $1`,
    [accountId, pendingTier],
  );
}

export async function incrementRetry(client: PoolClient, accountId: string): Promise<number> {
  const { rows } = await client.query<{ retry_count: number }>(
    `UPDATE subscription SET retry_count = retry_count + 1, status = 'past_due', updated_at = now()
     WHERE business_account_id = $1 RETURNING retry_count`,
    [accountId],
  );
  return rows[0]?.retry_count ?? 0;
}

/** On a successful charge: reset retries, roll the period, mark active. */
export async function recordSuccessfulCharge(
  client: PoolClient,
  accountId: string,
  newPeriodEnd: string,
): Promise<void> {
  await client.query(
    `UPDATE subscription
     SET retry_count = 0, status = 'active', last_charge_at = now(),
         current_period_start = now(), current_period_end = $2, updated_at = now()
     WHERE business_account_id = $1`,
    [accountId, newPeriodEnd],
  );
}

/** Applies a pending tier change to the active tier; returns the new tier if changed. */
export async function applyPendingTier(
  client: PoolClient,
  accountId: string,
): Promise<SubscriptionTierName | null> {
  const { rows } = await client.query<{ tier: SubscriptionTierName }>(
    `UPDATE subscription
     SET tier = pending_tier, pending_tier = NULL, updated_at = now()
     WHERE business_account_id = $1 AND pending_tier IS NOT NULL
     RETURNING tier`,
    [accountId],
  );
  return rows[0]?.tier ?? null;
}

/** System scan: subscriptions whose billing period has ended and are still billable. */
export async function listDueSubscriptions(
  client: PoolClient,
  nowIso: string,
): Promise<Subscription[]> {
  const { rows } = await client.query<Subscription>(
    `SELECT * FROM subscription
     WHERE status IN ('active','past_due') AND current_period_end <= $1`,
    [nowIso],
  );
  return rows;
}
