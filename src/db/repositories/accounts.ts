import type { PoolClient } from 'pg';
import { withSystem, withTenant } from '../pool.js';
import type { AccountStatus, BusinessAccount, SubscriptionTierName } from '../entities.js';

/**
 * Account creation runs in the system (cross-tenant) context because there is no
 * tenant context yet at registration time. Reads of an account run tenant-scoped
 * so RLS confirms the caller owns it.
 */
export async function createBusinessAccount(
  client: PoolClient,
  params: { name: string; tier?: SubscriptionTierName },
): Promise<BusinessAccount> {
  const { rows } = await client.query<BusinessAccount>(
    `INSERT INTO business_account (name, subscription_tier)
     VALUES ($1, $2) RETURNING *`,
    [params.name, params.tier ?? 'basic'],
  );
  return rows[0]!;
}

export async function setAccountOwner(
  client: PoolClient,
  accountId: string,
  ownerUserId: string,
): Promise<void> {
  await client.query(`UPDATE business_account SET owner_user_id = $2 WHERE id = $1`, [
    accountId,
    ownerUserId,
  ]);
}

export async function setAccountStatus(
  client: PoolClient,
  accountId: string,
  status: AccountStatus,
): Promise<void> {
  await client.query(`UPDATE business_account SET status = $2 WHERE id = $1`, [accountId, status]);
}

export async function setAccountTier(
  client: PoolClient,
  accountId: string,
  tier: SubscriptionTierName,
): Promise<void> {
  await client.query(`UPDATE business_account SET subscription_tier = $2 WHERE id = $1`, [
    accountId,
    tier,
  ]);
}

/** Tenant-scoped read; returns null if the account is not the caller's (RLS) or absent. */
export async function findAccountById(
  client: PoolClient,
  accountId: string,
): Promise<BusinessAccount | null> {
  const { rows } = await client.query<BusinessAccount>(
    `SELECT * FROM business_account WHERE id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** Convenience wrapper: read an account in its own tenant context. */
export async function getAccount(accountId: string): Promise<BusinessAccount | null> {
  return withTenant(accountId, (client) => findAccountById(client, accountId));
}

/** System-context helper to look up an account regardless of tenant (admin paths). */
export async function getAccountSystem(accountId: string): Promise<BusinessAccount | null> {
  return withSystem(async (client) => {
    const { rows } = await client.query<BusinessAccount>(
      `SELECT * FROM business_account WHERE id = $1`,
      [accountId],
    );
    return rows[0] ?? null;
  });
}
