import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { subscribe, runBillingCycle } from '../../src/billing/service.js';
import {
  getBillingProvider,
  MockBillingProvider,
  setBillingProvider,
} from '../../src/billing/providers.js';

/**
 * Integration test for the billing provider charge flow (REQ 13.3). Drives the real
 * provider abstraction (mock in dev/test; Stripe in production via env) through a
 * subscribe → charge cycle, including a declined-charge path.
 */
describe('Integration — billing provider charge boundary (REQ 13.3)', () => {
  beforeEach(async () => {
    await resetData();
    setBillingProvider(new MockBillingProvider());
  });
  afterEach(() => setBillingProvider(null));

  it('uses the configured provider to charge a subscription successfully', async () => {
    expect(getBillingProvider().name).toBe('mock');
    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'Pay', tier: 'premium' })).id);
    await subscribe(accountId, 'owner', 'premium');
    const outcome = await runBillingCycle(accountId);
    expect(outcome).toMatchObject({ charged: true, status: 'active' });
  });

  it('surfaces a declined charge as a retryable past_due outcome', async () => {
    const failing = new MockBillingProvider();
    failing.setOutcome(() => ({ success: false, reason: 'insufficient_funds' }));
    setBillingProvider(failing);

    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'Decline', tier: 'premium' })).id);
    await subscribe(accountId, 'owner', 'premium');
    const outcome = await runBillingCycle(accountId);
    expect(outcome.charged).toBe(false);
    expect(outcome.status).toBe('past_due');
  });
});
