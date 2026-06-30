import type { PoolClient } from 'pg';
import type { NotificationChannel } from '../db/entities.js';
import { enqueueNotification } from '../db/repositories/notifications.js';

/**
 * Resolves the channels enabled for an account (REQ 12.2, 12.4). When the account
 * has configured no preferences, in-app is enabled by default so dashboard alerts
 * always work; once preferences exist, only enabled channels are used.
 */
export async function getEnabledChannels(
  client: PoolClient,
  accountId: string,
): Promise<NotificationChannel[]> {
  const { rows } = await client.query<{ channel: NotificationChannel; enabled: boolean }>(
    `SELECT channel, enabled FROM notification_pref WHERE business_account_id = $1`,
    [accountId],
  );
  if (rows.length === 0) return ['in_app'];
  return rows.filter((r) => r.enabled).map((r) => r.channel);
}

/**
 * Enqueues a notification for each enabled channel. Idempotent per (account, channel)
 * via a channel-suffixed dedupe key, so repeated triggers never duplicate (ID3).
 * Actual delivery (with retries) is performed by the Notification Service.
 * Returns the number of notifications newly enqueued (deduped ones excluded).
 */
export async function notifyAccount(
  client: PoolClient,
  params: {
    accountId: string;
    type: string;
    dedupeKey: string | null;
    payload: Record<string, unknown>;
  },
): Promise<number> {
  const channels = await getEnabledChannels(client, params.accountId);
  let enqueued = 0;
  for (const channel of channels) {
    const row = await enqueueNotification(client, {
      businessAccountId: params.accountId,
      channel,
      type: params.type,
      dedupeKey: params.dedupeKey ? `${params.dedupeKey}:${channel}` : null,
      payload: params.payload,
    });
    if (row) enqueued += 1;
  }
  return enqueued;
}
