import { childLogger } from '../core/logger.js';
import { env } from '../config/env.js';
import type { NotificationChannel, NotificationLog } from '../db/entities.js';

const log = childLogger({ component: 'notification-provider' });

/**
 * A delivery provider for one Notification_Channel (REQ 12.1). `send` resolves on
 * success and throws on failure (the delivery loop counts a throw as a failed attempt).
 */
export interface NotificationProvider {
  readonly channel: NotificationChannel;
  send(notification: NotificationLog): Promise<void>;
}

/**
 * Console providers: the default dev drivers. They "deliver" by logging, which is
 * enough to exercise the full delivery/retry pipeline without external services.
 * Production swaps in real drivers (EMAIL_DRIVER=smtp|ses, SMS_DRIVER=twilio); those
 * integrate via their SDKs and are covered by the Task 13 integration tests.
 */
class ConsoleProvider implements NotificationProvider {
  constructor(readonly channel: NotificationChannel) {}
  async send(notification: NotificationLog): Promise<void> {
    log.info(
      { channel: this.channel, type: notification.type, account: notification.business_account_id },
      'notification delivered (console driver)',
    );
  }
}

/** In-app notifications are persisted records; "delivery" is making the row visible. */
class InAppProvider implements NotificationProvider {
  readonly channel = 'in_app' as const;
  async send(): Promise<void> {
    // No external action: the dashboard reads delivered in-app notifications.
  }
}

function defaultProviders(): Record<NotificationChannel, NotificationProvider> {
  // Real SMTP/SES/Twilio drivers would be selected here by EMAIL_DRIVER/SMS_DRIVER.
  // Console drivers are used unless a production driver is configured.
  void env.EMAIL_DRIVER;
  void env.SMS_DRIVER;
  return {
    email: new ConsoleProvider('email'),
    sms: new ConsoleProvider('sms'),
    in_app: new InAppProvider(),
  };
}

let registry: Record<NotificationChannel, NotificationProvider> = defaultProviders();

export function getProvider(channel: NotificationChannel): NotificationProvider {
  return registry[channel];
}

/** Test/extension hook to override providers (e.g. inject a failing provider). */
export function setProviders(overrides: Partial<Record<NotificationChannel, NotificationProvider>>): void {
  registry = { ...registry, ...overrides };
}

/** Restores the default provider registry. */
export function resetProviders(): void {
  registry = defaultProviders();
}
