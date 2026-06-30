import { describe, it, expect, beforeEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { upsertTender } from '../../src/db/repositories/tenders.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { pursue, scanReminders, scanGraceClosures, listPursued } from '../../src/deadline/service.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

async function seedAccountAndTender(deadlineIso: string): Promise<string> {
  return withSystem(async (c) => {
    const acct = await createBusinessAccount(c, { name: 'DG', tier: 'premium' });
    await upsertTender(
      c,
      toStored(
        normalizeListing(
          'PortalA',
          { sourceIdentifier: 'DG-1', title: 'Couplings', category: 'couplings', region: 'Patna', estimatedValue: 100000, deadline: deadlineIso },
          '2026-06-30T00:00:00.000Z',
        ),
      ),
    );
    return acct.id;
  });
}

async function countReminders(accountId: string): Promise<number> {
  return withSystem(async (c) => {
    const { rows } = await c.query<{ c: string }>(
      `SELECT count(*) c FROM notification_log WHERE business_account_id = $1 AND type = 'deadline_reminder'`,
      [accountId],
    );
    return Number(rows[0]!.c);
  });
}

describe('Deadline Guard service', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('fires a due reminder once and never duplicates it on re-scan (REQ 8.2, ID3)', async () => {
    const now = Date.now();
    const deadline = new Date(now + 5 * DAY).toISOString(); // 5 days out -> 7-day reminder due
    const accountId = await seedAccountAndTender(deadline);
    await pursue(accountId, 'owner', {
      sourcePortal: 'PortalA',
      sourceIdentifier: 'DG-1',
      trackedDeadline: deadline,
      reminderOffsetsDays: null,
    });

    const fired1 = await scanReminders(now);
    expect(fired1).toBe(1);
    const fired2 = await scanReminders(now);
    expect(fired2).toBe(0);
    expect(await countReminders(accountId)).toBe(1);
  });

  it('closes a pursued tender past its deadline + grace period (REQ 8.5)', async () => {
    const now = Date.now();
    const deadline = new Date(now - 25 * HOUR).toISOString();
    const accountId = await seedAccountAndTender(deadline);
    await pursue(accountId, 'owner', {
      sourcePortal: 'PortalA',
      sourceIdentifier: 'DG-1',
      trackedDeadline: deadline,
      reminderOffsetsDays: null,
    });

    const closed = await scanGraceClosures();
    expect(closed).toBeGreaterThanOrEqual(1);
    const pursued = await listPursued(accountId);
    expect(pursued[0]?.stage).toBe('closed');
    expect(pursued[0]?.closed_at).not.toBeNull();
  });
});
