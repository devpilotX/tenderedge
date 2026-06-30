import type { PoolClient } from 'pg';
import type { NotificationChannel, NotificationLog, NotificationStatus } from '../entities.js';

/**
 * Notification log repository. The partial unique index on (business_account_id,
 * dedupe_key) makes inserts idempotent: a notification already enqueued/delivered
 * for a given dedupe_key is never duplicated (ID3, REQ 12).
 */
export interface EnqueueNotificationInput {
  businessAccountId: string;
  channel: NotificationChannel;
  type: string;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
}

/** Inserts a pending notification; returns the row, or null if deduped away. */
export async function enqueueNotification(
  client: PoolClient,
  input: EnqueueNotificationInput,
): Promise<NotificationLog | null> {
  const { rows } = await client.query<NotificationLog>(
    `INSERT INTO notification_log (business_account_id, channel, type, status, dedupe_key, payload)
     VALUES ($1,$2,$3,'pending',$4,$5)
     ON CONFLICT (business_account_id, dedupe_key) WHERE dedupe_key IS NOT NULL
       DO NOTHING
     RETURNING *`,
    [input.businessAccountId, input.channel, input.type, input.dedupeKey, JSON.stringify(input.payload)],
  );
  return rows[0] ?? null;
}

export async function setNotificationStatus(
  client: PoolClient,
  id: string,
  status: NotificationStatus,
  retryCount: number,
): Promise<void> {
  await client.query(
    `UPDATE notification_log
     SET status = $2, retry_count = $3, sent_at = CASE WHEN $2 = 'delivered' THEN now() ELSE sent_at END
     WHERE id = $1`,
    [id, status, retryCount],
  );
}

export async function listPendingNotifications(
  client: PoolClient,
  limit = 100,
): Promise<NotificationLog[]> {
  const { rows } = await client.query<NotificationLog>(
    `SELECT * FROM notification_log WHERE status = 'pending' ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function listNotificationsForAccount(
  client: PoolClient,
  businessAccountId: string,
  limit = 50,
): Promise<NotificationLog[]> {
  const { rows } = await client.query<NotificationLog>(
    `SELECT * FROM notification_log WHERE business_account_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [businessAccountId, limit],
  );
  return rows;
}
