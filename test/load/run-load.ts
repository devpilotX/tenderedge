import { performance } from 'node:perf_hooks';
import { getAdminPool, withTenant, withSystem, closePool } from '../../src/db/pool.js';
import { migrateUp } from '../../src/db/migrate.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { upsertMatchFilter } from '../../src/db/repositories/match-filters.js';
import { listMatchesByScore } from '../../src/db/repositories/matches.js';
import { getTender } from '../../src/db/repositories/tenders.js';
import { evaluateTender } from '../../src/match/service.js';
import { logger } from '../../src/core/logger.js';

/**
 * Load test for the scale & latency targets (REQ 15):
 *  - 15.1 store >= 10M tenders (set LOAD_TENDERS=10000000 on capable hardware)
 *  - 15.2 first page of matched tenders within 2s p95
 *  - 15.3 evaluate a newly stored tender against accounts within 10s
 *
 * Default N is modest so it runs quickly anywhere; raise LOAD_TENDERS to approach the
 * 10M target. Data is inserted server-side via generate_series across all HASH
 * partitions and cleaned up afterward.
 */
const N = Number(process.env.LOAD_TENDERS ?? 20000);
const ITERS = 50;

function percentile(sortedAsc: number[], p: number): number {
  const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
  return sortedAsc[idx]!;
}

async function main(): Promise<void> {
  await migrateUp();
  const pool = getAdminPool();

  const accountId = await withSystem(async (c) => {
    const acct = await createBusinessAccount(c, { name: 'LoadTest', tier: 'enterprise' });
    await upsertMatchFilter(c, acct.id, {
      regions: ['Patna', 'Gaya', 'Samastipur'],
      productCategories: ['Mechanical Couplings'],
      minValue: null,
      maxValue: null,
    });
    return acct.id;
  });

  logger.info({ N }, 'seeding tenders + matches');
  const t0 = performance.now();
  // Spread across 4 source portals so all 8 hash partitions are exercised.
  await pool.query(
    `INSERT INTO tender (source_portal, source_identifier, title, product_category, region,
        estimated_value, estimated_value_status, deadline, deadline_status, status, retrieved_at)
     SELECT 'LP-' || (g % 4), 'LOAD-' || g, 'Load Tender ' || g, 'Mechanical Couplings',
            (ARRAY['Patna','Gaya','Samastipur'])[1 + (g % 3)],
            (100000 + (g % 80) * 1000)::numeric, 'known',
            now() + ((g % 60) || ' days')::interval, 'known', 'open', now()
     FROM generate_series(1, $1) g`,
    [N],
  );
  await pool.query(
    `INSERT INTO tender_match (business_account_id, tender_source_portal, tender_source_identifier, match_score)
     SELECT $1, 'LP-' || (g % 4), 'LOAD-' || g, 1 + (g % 100)
     FROM generate_series(1, $2) g`,
    [accountId, N],
  );
  logger.info({ seedMs: Math.round(performance.now() - t0) }, 'seed complete');

  // REQ 15.2 — first page of matched tenders, p95 over many runs.
  const times: number[] = [];
  for (let i = 0; i < ITERS; i++) {
    const s = performance.now();
    await withTenant(accountId, (c) => listMatchesByScore(c, accountId, 20, 0));
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  const p95 = percentile(times, 95);

  // REQ 15.3 — evaluate one tender against configured accounts.
  const tender = await withSystem((c) => getTender(c, 'LP-1', 'LOAD-1'));
  const e0 = performance.now();
  if (tender) await evaluateTender(tender);
  const evalMs = performance.now() - e0;

  logger.info(
    {
      tenders: N,
      matchQueryP95Ms: Math.round(p95),
      matchQueryTarget: '< 2000ms',
      matchQueryPass: p95 < 2000,
      evaluateMs: Math.round(evalMs),
      evaluateTarget: '< 10000ms',
      evaluatePass: evalMs < 10000,
    },
    'LOAD TEST RESULTS',
  );

  // Cleanup load data.
  await pool.query(`DELETE FROM tender_match WHERE business_account_id = $1`, [accountId]);
  await pool.query(`DELETE FROM tender WHERE source_portal LIKE 'LP-%'`);
  await pool.query(`DELETE FROM business_account WHERE id = $1`, [accountId]);

  const pass = p95 < 2000 && evalMs < 10000;
  await closePool();
  if (!pass) {
    logger.error('load test did not meet latency targets');
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error({ err }, 'load test failed');
  process.exit(1);
});
