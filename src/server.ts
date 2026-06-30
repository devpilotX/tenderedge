import type { Server } from 'node:http';
import { createApp } from './http/app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { getQueue } from './queue/index.js';
import { closePool, withSystem } from './db/pool.js';
import { registerRadarJobs } from './radar/scheduler.js';
import { evaluateTender, pruneExpiredMatches } from './match/service.js';
import { scanReminders, scanGraceClosures } from './deadline/service.js';
import { scanExpiringDocuments } from './documents/service.js';
import { processPendingNotifications } from './notifications/delivery.js';
import { runDueBillingCycles } from './billing/service.js';
import { closeExpiredTenders } from './db/repositories/tenders.js';

async function main(): Promise<void> {
  const app = createApp();
  const queue = getQueue();
  await queue.start();
  logger.info({ driver: queue.driver }, 'job queue started');

  // Tender Radar: schedule polling for every configured portal (auto-recovers on restart).
  // Each upserted tender is evaluated by Smart Match against all configured accounts.
  await registerRadarJobs(queue, {
    onUpserted: async (tender) => {
      await evaluateTender(tender);
    },
  });

  // Maintenance: close expired tenders and prune stale matches (REQ 5.6) every 15 minutes.
  queue.register('match.maintenance', async () => {
    await withSystem((c) => closeExpiredTenders(c));
    const removed = await pruneExpiredMatches();
    if (removed > 0) logger.info({ removed }, 'pruned expired matches');
  });
  await queue.scheduleRepeating(
    'match.maintenance',
    {},
    { everyMs: 15 * 60_000, jobId: 'match:maintenance' },
  );

  // Deadline Guard: fire due reminders and close pursued tenders past grace (REQ 8).
  // Also scan documents nearing expiry (REQ 9.4).
  queue.register('deadline.scan', async () => {
    await scanReminders();
    await scanGraceClosures();
    await scanExpiringDocuments();
  });
  await queue.scheduleRepeating(
    'deadline.scan',
    {},
    { everyMs: 5 * 60_000, jobId: 'deadline:scan' },
  );

  // Notification Service: deliver pending notifications with bounded retry (REQ 12).
  queue.register('notification.dispatch', async () => {
    await processPendingNotifications();
  });
  await queue.scheduleRepeating(
    'notification.dispatch',
    {},
    { everyMs: 60_000, jobId: 'notification:dispatch' },
  );

  // Subscription billing: charge due subscriptions, retry, and restrict on non-payment (REQ 13).
  queue.register('billing.cycle', async () => {
    const processed = await runDueBillingCycles();
    if (processed > 0) logger.info({ processed }, 'billing cycles processed');
  });
  await queue.scheduleRepeating(
    'billing.cycle',
    {},
    { everyMs: 24 * 60 * 60_000, jobId: 'billing:cycle' },
  );

  const server: Server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'TenderEdge API listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await queue.stop();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start server');
  process.exit(1);
});
