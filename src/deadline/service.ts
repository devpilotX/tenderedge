import { withSystem, withTenant } from '../db/pool.js';
import { runWrite } from '../auth/rbac.js';
import { DEFAULT_GRACE_PERIOD_HOURS, DEFAULT_REMINDER_DAYS } from '../config/platform.js';
import type { PursuedTender, PursuitStage, UserRole } from '../db/entities.js';
import {
  closePursuedPastGrace,
  listActivePursuedWithDeadline,
  listPursued as listPursuedRepo,
  pursueTender,
  setStage as setStageRepo,
  unpursueTender,
} from '../db/repositories/pursued.js';
import { notifyAccount } from '../notifications/notify.js';
import { computeDueReminders } from './reminders.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'deadline-guard' });

export interface PursueParams {
  sourcePortal: string;
  sourceIdentifier: string;
  trackedDeadline: string | null;
  reminderOffsetsDays?: number[] | null;
  stage?: PursuitStage;
}

/** Saves a tender to pursue and tracks its deadline (REQ 8.1). Write-gated. */
export async function pursue(
  accountId: string,
  role: UserRole,
  params: PursueParams,
): Promise<PursuedTender> {
  return runWrite(role, () =>
    withTenant(accountId, (c) =>
      pursueTender(c, {
        businessAccountId: accountId,
        sourcePortal: params.sourcePortal,
        sourceIdentifier: params.sourceIdentifier,
        trackedDeadline: params.trackedDeadline,
        reminderOffsetsDays: params.reminderOffsetsDays ?? null,
        stage: params.stage,
      }),
    ),
  );
}

export async function unpursue(
  accountId: string,
  role: UserRole,
  sourcePortal: string,
  sourceIdentifier: string,
): Promise<void> {
  await runWrite(role, () =>
    withTenant(accountId, (c) => unpursueTender(c, accountId, sourcePortal, sourceIdentifier)),
  );
}

export async function listPursued(accountId: string): Promise<PursuedTender[]> {
  return withTenant(accountId, (c) => listPursuedRepo(c, accountId));
}

export async function setStage(
  accountId: string,
  role: UserRole,
  sourcePortal: string,
  sourceIdentifier: string,
  stage: PursuitStage,
): Promise<void> {
  await runWrite(role, () =>
    withTenant(accountId, (c) => setStageRepo(c, accountId, sourcePortal, sourceIdentifier, stage)),
  );
}

/** Configures custom reminder intervals for a pursued tender (REQ 8.4). */
export async function configureReminders(
  accountId: string,
  role: UserRole,
  sourcePortal: string,
  sourceIdentifier: string,
  offsetsDays: number[],
): Promise<void> {
  await runWrite(role, () =>
    withTenant(accountId, async (c) => {
      await c.query(
        `UPDATE pursued_tender SET reminder_offsets_days = $4
         WHERE business_account_id = $1 AND tender_source_portal = $2 AND tender_source_identifier = $3`,
        [accountId, sourcePortal, sourceIdentifier, offsetsDays],
      );
    }),
  );
}

/**
 * Fires due deadline reminders across all accounts (REQ 8.2–8.4). Idempotent: each
 * (pursued, offset) reminder is enqueued with a stable dedupe key so it is never
 * sent twice (ID3). Returns the number of reminders newly enqueued.
 */
export async function scanReminders(nowMs: number = Date.now()): Promise<number> {
  let fired = 0;
  await withSystem(async (client) => {
    const active = await listActivePursuedWithDeadline(client);
    for (const p of active) {
      const offsets = p.reminder_offsets_days ?? [...DEFAULT_REMINDER_DAYS];
      const due = computeDueReminders(new Date(p.tracked_deadline).getTime(), offsets, nowMs, []);
      for (const offset of due) {
        const enqueued = await notifyAccount(client, {
          accountId: p.business_account_id,
          type: 'deadline_reminder',
          dedupeKey: `deadline:${p.id}:${offset}`,
          payload: {
            pursuedId: p.id,
            sourcePortal: p.tender_source_portal,
            sourceIdentifier: p.tender_source_identifier,
            daysRemaining: offset,
            deadline: new Date(p.tracked_deadline).toISOString(),
          },
        });
        fired += enqueued;
      }
    }
  });
  if (fired > 0) log.info({ fired }, 'enqueued deadline reminders');
  return fired;
}

/** Closes pursued tenders past their deadline + grace period (REQ 8.5). */
export async function scanGraceClosures(): Promise<number> {
  const closed = await withSystem((c) => closePursuedPastGrace(c, DEFAULT_GRACE_PERIOD_HOURS));
  if (closed.length > 0) log.info({ closed: closed.length }, 'closed pursued tenders past grace');
  return closed.length;
}
