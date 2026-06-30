import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { enqueueNotification, listNotificationsForAccount } from '../../src/db/repositories/notifications.js';
import { processPendingNotifications } from '../../src/notifications/delivery.js';
import { resetProviders } from '../../src/notifications/providers.js';

/**
 * Integration test for email/SMS/in-app delivery (REQ 12.1). Drives the real default
 * provider registry (console drivers) end to end through the dispatch loop. Production
 * swaps SMTP/SES/Twilio in via env without changing this flow.
 */
describe('Integration — notification delivery boundary (REQ 12.1)', () => {
  beforeEach(async () => {
    await resetData();
    resetProviders();
  });
  afterEach(() => resetProviders());

  it('delivers queued notifications across channels via the configured providers', async () => {
    const accountId = await withSystem(async (c) => {
      const acct = await createBusinessAccount(c, { name: 'Notif', tier: 'basic' });
      for (const channel of ['email', 'sms', 'in_app'] as const) {
        await enqueueNotification(c, { businessAccountId: acct.id, channel, type: 'welcome', dedupeKey: null, payload: { hi: true } });
      }
      return acct.id;
    });

    const summary = await processPendingNotifications();
    expect(summary.delivered).toBe(3);
    expect(summary.failed).toBe(0);

    const rows = await withSystem((c) => listNotificationsForAccount(c, accountId));
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'delivered' && r.sent_at !== null)).toBe(true);
  });
});
