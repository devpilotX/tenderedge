import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import {
  enqueueNotification,
  listNotificationsForAccount,
} from '../../src/db/repositories/notifications.js';
import { notifyAccount } from '../../src/notifications/notify.js';
import { processPendingNotifications } from '../../src/notifications/delivery.js';
import { setProviders, resetProviders, type NotificationProvider } from '../../src/notifications/providers.js';
import { setChannelPreference } from '../../src/notifications/service.js';
import type { NotificationChannel } from '../../src/db/entities.js';

/** Provider that fails its first `failTimes` attempts, then succeeds. */
class FlakyProvider implements NotificationProvider {
  attempts = 0;
  constructor(readonly channel: NotificationChannel, private failTimes: number) {}
  async send(): Promise<void> {
    this.attempts += 1;
    if (this.attempts <= this.failTimes) throw new Error('transient failure');
  }
}

async function newAccount(): Promise<string> {
  return withSystem(async (c) => (await createBusinessAccount(c, { name: 'N', tier: 'basic' })).id);
}

async function statusOf(accountId: string): Promise<{ status: string; retry: number } | null> {
  const rows = await withSystem((c) => listNotificationsForAccount(c, accountId));
  const n = rows[0];
  return n ? { status: n.status, retry: n.retry_count } : null;
}

describe('Notification Service — delivery', () => {
  beforeEach(async () => {
    await resetData();
    resetProviders();
  });
  afterEach(() => resetProviders());

  it('delivers through every enabled channel and honors channel toggles (REQ 12.1, 12.2, 12.4)', async () => {
    const accountId = await newAccount();
    await setChannelPreference(accountId, 'owner', 'email', true);
    await setChannelPreference(accountId, 'owner', 'sms', true);
    await setChannelPreference(accountId, 'owner', 'in_app', true);
    await setChannelPreference(accountId, 'owner', 'sms', false);

    const enqueued = await withSystem((c) =>
      notifyAccount(c, { accountId, type: 'test', dedupeKey: 'k1', payload: {} }),
    );
    expect(enqueued).toBe(2); // email + in_app (sms disabled)

    const summary = await processPendingNotifications();
    expect(summary.delivered).toBe(2);
    const rows = await withSystem((c) => listNotificationsForAccount(c, accountId));
    expect(rows.every((r) => r.status === 'delivered')).toBe(true);
  });

  it('retries a transient failure and increments retry only on failure (REQ 12.3)', async () => {
    const accountId = await newAccount();
    setProviders({ email: new FlakyProvider('email', 2) });
    await withSystem((c) =>
      enqueueNotification(c, { businessAccountId: accountId, channel: 'email', type: 'test', dedupeKey: null, payload: {} }),
    );

    await processPendingNotifications();
    expect(await statusOf(accountId)).toEqual({ status: 'pending', retry: 1 });
    await processPendingNotifications();
    expect(await statusOf(accountId)).toEqual({ status: 'pending', retry: 2 });
    await processPendingNotifications();
    expect(await statusOf(accountId)).toEqual({ status: 'delivered', retry: 2 });
  });

  it('records final failure after 3 attempts and never resends (REQ 12.3, ID3)', async () => {
    const accountId = await newAccount();
    setProviders({ email: new FlakyProvider('email', 99) });
    await withSystem((c) =>
      enqueueNotification(c, { businessAccountId: accountId, channel: 'email', type: 'test', dedupeKey: null, payload: {} }),
    );

    await processPendingNotifications();
    await processPendingNotifications();
    const third = await processPendingNotifications();
    expect(third.failed).toBe(1);
    expect(await statusOf(accountId)).toEqual({ status: 'failed', retry: 3 });

    const fourth = await processPendingNotifications();
    expect(fourth.attempted).toBe(0);
  });

  it('never resends an already-delivered notification (ID3)', async () => {
    const accountId = await newAccount();
    await withSystem((c) =>
      enqueueNotification(c, { businessAccountId: accountId, channel: 'in_app', type: 'test', dedupeKey: null, payload: {} }),
    );
    const first = await processPendingNotifications();
    expect(first.delivered).toBe(1);
    const second = await processPendingNotifications();
    expect(second.attempted).toBe(0);
  });
});
