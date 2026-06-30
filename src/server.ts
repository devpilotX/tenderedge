import type { Server } from 'node:http';
import { createApp } from './http/app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { getQueue } from './queue/index.js';
import { closePool, withSystem } from './db/pool.js';
import { registerRadarJobs } from './radar/scheduler.js';
import { evaluateTender, pruneExpiredMatches } from './match/service.js';
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
