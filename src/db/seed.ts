import { loadPortalsConfig } from '../config/portals.js';
import { withSystem, closePool } from './pool.js';
import { upsertPortal } from './repositories/portals.js';
import { logger } from '../core/logger.js';

/**
 * Seeds Source_Portal rows from config/portals.json (idempotent upsert by name).
 * Safe to run repeatedly.
 */
async function main(): Promise<void> {
  const portals = loadPortalsConfig();
  await withSystem(async (client) => {
    for (const p of portals) {
      await upsertPortal(client, {
        name: p.name,
        baseUrl: p.baseUrl,
        rateLimitRpm: p.rateLimitRpm,
        publicFlag: p.publicFlag,
        accessPolicy: p.accessPolicyPath,
        pollIntervalMinutes: p.pollIntervalMinutes,
      });
    }
  });
  logger.info({ count: portals.length }, 'seeded source portals');
  await closePool();
}

main().catch((err) => {
  logger.error({ err }, 'seed failed');
  process.exit(1);
});
