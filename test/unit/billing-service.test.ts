import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withSystem, withTenant } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount, getAccountSystem } from '../../src/db/repositories/accounts.js';
import { upsertMatchFilter } from '../../src/db/repositories/match-filters.js';
import { getSubscription } from '../../src/db/repositories/subscriptions.js';
import {
  subscribe,
  changeTier,
  selectRegionsForDowngrade,
  runBillingCycle,
} from '../../src/billing/service.js';
import { MockBillingProvider, setBillingProvider } from '../../src/billing/providers.js';
import { ForbiddenError } from '../../src/core/errors.js';

async function newAccount(): Promise<string> {
  return withSystem(async (c) => (await createBusinessAccount(c, { name: 'Biz', tier: 'basic' })).id);
}

async function setRegions(accountId: string, regions: string[]): Promise<void> {
  await withTenant(accountId, (c) =>
    upsertMatchFilter(c, accountId, { regions, productCategories: [], minValue: null, maxValue: null }),
  );
}

describe('Subscription & Billing service', () => {
  beforeEach(async () => {
    await resetData();
    setBillingProvider(new MockBillingProvider());
  });
  afterEach(() => setBillingProvider(null));

  it('subscribes and grants tier entitlements (REQ 13.1, 13.2); owner-only', async () => {
    const accountId = await newAccount();
    await expect(subscribe(accountId, 'manager', 'premium')).rejects.toBeInstanceOf(ForbiddenError);

    await subscribe(accountId, 'owner', 'premium');
    const account = await getAccountSystem(accountId);
    expect(account?.subscription_tier).toBe('premium');
    const sub = await withSystem((c) => getSubscription(c, accountId));
    expect(sub?.tier).toBe('premium');
    expect(sub?.status).toBe('active');
  });

  it('applies a tier change at the next billing cycle (REQ 13.6)', async () => {
    const accountId = await newAccount();
    await subscribe(accountId, 'owner', 'premium');
    const change = await changeTier(accountId, 'owner', 'enterprise');
    expect(change.needsRegionSelection).toBe(false);
    expect(change.pendingTier).toBe('enterprise');

    expect((await getAccountSystem(accountId))?.subscription_tier).toBe('premium');

    const outcome = await runBillingCycle(accountId);
    expect(outcome.charged).toBe(true);
    expect((await getAccountSystem(accountId))?.subscription_tier).toBe('enterprise');
  });

  it('prompts for region selection when a downgrade exceeds the tier limit (REQ 13.7)', async () => {
    const accountId = await newAccount();
    await subscribe(accountId, 'owner', 'premium');
    await setRegions(accountId, ['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);

    const change = await changeTier(accountId, 'owner', 'basic');
    expect(change.needsRegionSelection).toBe(true);
    expect(change.allowedRegions).toBe(5);
    expect(change.currentRegions).toHaveLength(6);

    await selectRegionsForDowngrade(accountId, 'owner', 'basic', ['R1', 'R2', 'R3', 'R4', 'R5']);
    const sub = await withSystem((c) => getSubscription(c, accountId));
    expect(sub?.pending_tier).toBe('basic');
  });

  it('retries a failed charge up to 3 times then restricts to read-only (REQ 13.4, 13.5)', async () => {
    const accountId = await newAccount();
    await subscribe(accountId, 'owner', 'premium');

    const failing = new MockBillingProvider();
    failing.setOutcome(() => ({ success: false, reason: 'card declined' }));
    setBillingProvider(failing);

    const a1 = await runBillingCycle(accountId);
    expect(a1).toMatchObject({ charged: false, status: 'past_due', retryCount: 1 });
    const a2 = await runBillingCycle(accountId);
    expect(a2).toMatchObject({ status: 'past_due', retryCount: 2 });
    const a3 = await runBillingCycle(accountId);
    expect(a3).toMatchObject({ status: 'read_only', retryCount: 3 });

    expect((await getAccountSystem(accountId))?.status).toBe('read_only');
  });

  it('reactivates the account on a later successful charge', async () => {
    const accountId = await newAccount();
    await subscribe(accountId, 'owner', 'premium');
    const failing = new MockBillingProvider();
    failing.setOutcome(() => ({ success: false }));
    setBillingProvider(failing);
    await runBillingCycle(accountId);
    await runBillingCycle(accountId);
    await runBillingCycle(accountId);
    expect((await getAccountSystem(accountId))?.status).toBe('read_only');

    setBillingProvider(new MockBillingProvider());
    const recovered = await runBillingCycle(accountId);
    expect(recovered.status).toBe('active');
    expect((await getAccountSystem(accountId))?.status).toBe('active');
  });
});
