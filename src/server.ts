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
import { getRealtimeHub } from './realtime/hub.js';

async function main(): Promise<void> {
  const app = createApp();
  const queue = getQueue();
  const hub = getRealtimeHub();
  await queue.start();
  logger.info({ driver: queue.driver }, 'job queue started');

  // Tender Radar: schedule polling for every configured portal (auto-recovers on restart).
  // Each upserted tender is evaluated by Smart Match against all configured accounts,
  // and new matches are pushed to live dashboards over WebSocket (REQ 11.1).
  await registerRadarJobs(queue, {
    onUpserted: async (tender) => {
      await evaluateTender(tender, {
        onMatched: (m) => {
          hub.publish(m.businessAccountId, {
            type: 'match',
            sourcePortal: m.sourcePortal,
            sourceIdentifier: m.sourceIdentifier,
            title: tender.title,
            matchScore: m.matchScore,
          });
        },
      });
    },
  });

  // Maintenance: close expired tenders, push status changes to live dashboards, and
  // prune stale matches (REQ 5.6, 11.2) every 15 minutes.
  queue.register('match.maintenance', async () => {
    const closed = await withSystem((c) => closeExpiredTenders(c));
    for (const t of closed) {
      const accounts = await withSystem(async (c) => {
        const { rows } = await c.query<{ business_account_id: string }>(
          `SELECT business_account_id FROM tender_match
           WHERE tender_source_portal = $1 AND tender_source_identifier = $2`,
          [t.source_portal, t.source_identifier],
        );
        return rows.map((r) => r.business_account_id);
      });
      for (const accountId of accounts) {
        hub.publish(accountId, {
          type: 'tender_status',
          sourcePortal: t.source_portal,
          sourceIdentifier: t.source_identifier,
          status: 'closed',
        });
      }
    }
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

  // Realtime dashboard updates over WebSocket at /ws (REQ 11).
  hub.attach(server);

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
