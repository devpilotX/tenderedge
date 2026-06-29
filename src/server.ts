import type { Server } from 'node:http';
import { createApp } from './http/app.js';
import { env } from './config/env.js';
import { logger } from './core/logger.js';
import { getQueue } from './queue/index.js';
import { closePool } from './db/pool.js';

async function main(): Promise<void> {
  const app = createApp();
  const queue = getQueue();
  await queue.start();
  logger.info({ driver: queue.driver }, 'job queue started');

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
