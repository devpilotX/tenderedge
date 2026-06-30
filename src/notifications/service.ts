import { withTenant } from '../db/pool.js';
import { runWrite } from '../auth/rbac.js';
import type { NotificationChannel, NotificationLog, UserRole } from '../db/entities.js';
import {
  listNotificationPrefs,
  listNotificationsForAccount,
  upsertNotificationPref,
} from '../db/repositories/notifications.js';

/** Enables/disables a notification channel for the account (REQ 12.4). Write-gated. */
export async function setChannelPreference(
  accountId: string,
  role: UserRole,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<void> {
  await runWrite(role, () =>
    withTenant(accountId, (c) => upsertNotificationPref(c, accountId, channel, enabled)),
  );
}

export async function getChannelPreferences(
  accountId: string,
): Promise<{ channel: NotificationChannel; enabled: boolean }[]> {
  return withTenant(accountId, (c) => listNotificationPrefs(c, accountId));
}

export async function listNotifications(accountId: string, limit = 50): Promise<NotificationLog[]> {
  return withTenant(accountId, (c) => listNotificationsForAccount(c, accountId, limit));
}
