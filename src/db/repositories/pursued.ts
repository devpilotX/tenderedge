import type { PoolClient } from 'pg';
import type { PursuedTender, PursuitStage } from '../entities.js';

/**
 * Pursued-tender repository (Deadline Guard, REQ 8). Tenant-scoped for user actions;
 * a few system-context scans drive the reminder and grace-closure jobs.
 */
export interface PursueInput {
  businessAccountId: string;
  sourcePortal: string;
  sourceIdentifier: string;
  trackedDeadline: string | null; // ISO
  reminderOffsetsDays: number[] | null; // null = platform defaults
  stage?: PursuitStage;
}

export async function pursueTender(client: PoolClient, input: PursueInput): Promise<PursuedTender> {
  const { rows } = await client.query<PursuedTender>(
    `INSERT INTO pursued_tender
       (business_account_id, tender_source_portal, tender_source_identifier,
        stage, tracked_deadline, reminder_offsets_days)
     VALUES ($1,$2,$3,COALESCE($4,'watching'),$5,$6)
     ON CONFLICT (business_account_id, tender_source_portal, tender_source_identifier)
       DO UPDATE SET tracked_deadline = EXCLUDED.tracked_deadline,
                     reminder_offsets_days = EXCLUDED.reminder_offsets_days,
                     stage = COALESCE($4, pursued_tender.stage)
     RETURNING *`,
    [
      input.businessAccountId,
      input.sourcePortal,
      input.sourceIdentifier,
      input.stage ?? null,
      input.trackedDeadline,
      input.reminderOffsetsDays,
    ],
  );
  return rows[0]!;
}

export async function unpursueTender(
  client: PoolClient,
  accountId: string,
  sourcePortal: string,
  sourceIdentifier: string,
): Promise<void> {
  await client.query(
    `DELETE FROM pursued_tender
     WHERE business_account_id = $1 AND tender_source_portal = $2 AND tender_source_identifier = $3`,
    [accountId, sourcePortal, sourceIdentifier],
  );
}

export async function listPursued(
  client: PoolClient,
  accountId: string,
): Promise<PursuedTender[]> {
  const { rows } = await client.query<PursuedTender>(
    `SELECT * FROM pursued_tender WHERE business_account_id = $1 ORDER BY tracked_deadline NULLS LAST`,
    [accountId],
  );
  return rows;
}

export async function setStage(
  client: PoolClient,
  accountId: string,
  sourcePortal: string,
  sourceIdentifier: string,
  stage: PursuitStage,
): Promise<void> {
  await client.query(
    `UPDATE pursued_tender SET stage = $4
     WHERE business_account_id = $1 AND tender_source_portal = $2 AND tender_source_identifier = $3`,
    [accountId, sourcePortal, sourceIdentifier, stage],
  );
}

/** System scan: active (not closed) pursued tenders that have a tracked deadline. */
export interface ActivePursued {
  id: string;
  business_account_id: string;
  tender_source_portal: string;
  tender_source_identifier: string;
  tracked_deadline: Date;
  reminder_offsets_days: number[] | null;
}

export async function listActivePursuedWithDeadline(client: PoolClient): Promise<ActivePursued[]> {
  const { rows } = await client.query<ActivePursued>(
    `SELECT id, business_account_id, tender_source_portal, tender_source_identifier,
            tracked_deadline, reminder_offsets_days
     FROM pursued_tender
     WHERE closed_at IS NULL AND stage <> 'closed' AND tracked_deadline IS NOT NULL`,
  );
  return rows;
}

/** System scan: close pursued tenders whose deadline passed more than `graceHours` ago (REQ 8.5). */
export async function closePursuedPastGrace(
  client: PoolClient,
  graceHours: number,
): Promise<{ id: string; business_account_id: string }[]> {
  const { rows } = await client.query<{ id: string; business_account_id: string }>(
    `UPDATE pursued_tender
     SET stage = 'closed', closed_at = now()
     WHERE closed_at IS NULL
       AND tracked_deadline IS NOT NULL
       AND tracked_deadline < now() - ($1 || ' hours')::interval
     RETURNING id, business_account_id`,
    [graceHours],
  );
  return rows;
}
