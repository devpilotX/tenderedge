import { withSystem } from '../db/pool.js';
import { NOTIFICATION_MAX_RETRIES } from '../config/platform.js';
import {
  listPendingNotifications,
  setNotificationStatus,
} from '../db/repositories/notifications.js';
import { getProvider } from './providers.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'notification-delivery' });

export interface DispatchSummary {
  attempted: number;
  delivered: number;
  failed: number; // reached final failure this pass
  retrying: number; // failed this pass but will retry
}

/**
 * Processes pending notifications once (REQ 12.2, 12.3).
 *
 * Only `pending` notifications are considered, so a delivered notification is never
 * re-sent (ID3). Each attempt calls the channel provider; on success the row is marked
 * `delivered`. On failure the retry count is incremented (only on an actual failure)
 * and, once it reaches NOTIFICATION_MAX_RETRIES (3), the final outcome is recorded as
 * `failed`; otherwise it stays `pending` for the next pass.
 */
export async function processPendingNotifications(limit = 200): Promise<DispatchSummary> {
  const summary: DispatchSummary = { attempted: 0, delivered: 0, failed: 0, retrying: 0 };

  await withSystem(async (client) => {
    const pending = await listPendingNotifications(client, limit);
    for (const n of pending) {
      summary.attempted += 1;
      try {
        await getProvider(n.channel).send(n);
        await setNotificationStatus(client, n.id, 'delivered', n.retry_count);
        summary.delivered += 1;
      } catch (err) {
        const nextRetry = n.retry_count + 1; // increment only on actual failure
        if (nextRetry >= NOTIFICATION_MAX_RETRIES) {
          await setNotificationStatus(client, n.id, 'failed', nextRetry);
          summary.failed += 1;
          log.error(
            { id: n.id, channel: n.channel, attempts: nextRetry, err },
            'notification delivery failed permanently',
          );
        } else {
          await setNotificationStatus(client, n.id, 'pending', nextRetry);
          summary.retrying += 1;
          log.warn({ id: n.id, channel: n.channel, attempt: nextRetry, err }, 'delivery failed; will retry');
        }
      }
    }
  });

  if (summary.attempted > 0) log.debug(summary, 'notification dispatch pass complete');
  return summary;
}
