import { describe, it, expect, beforeEach } from 'vitest';
import { performance } from 'node:perf_hooks';
import { getAdminPool, withTenant, withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { listMatchesByScore } from '../../src/db/repositories/matches.js';

/**
 * Representative-scale performance smoke (REQ 15.2): with several thousand matched
 * tenders, the first page of results returns well under the 2-second p95 target,
 * thanks to the (business_account_id, match_score DESC) index. The full 10M-record
 * target is exercised by `npm run test:load`.
 */
const N = 3000;

describe('Performance — matched tenders first page (REQ 15.2)', () => {
  beforeEach(async () => {
    await resetData();
  });

  it(`returns the first page within 2s over ${N} matches`, async () => {
    const pool = getAdminPool();
    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'Perf', tier: 'enterprise' })).id);

    await pool.query(
      `INSERT INTO tender (source_portal, source_identifier, title, product_category, region,
          estimated_value, estimated_value_status, deadline, deadline_status, status, retrieved_at)
       SELECT 'PP-' || (g % 4), 'P-' || g, 'Perf ' || g, 'Mechanical Couplings', 'Patna',
              (100000 + g)::numeric, 'known', now() + '30 days'::interval, 'known', 'open', now()
       FROM generate_series(1, $1) g`,
      [N],
    );
    await pool.query(
      `INSERT INTO tender_match (business_account_id, tender_source_portal, tender_source_identifier, match_score)
       SELECT $1, 'PP-' || (g % 4), 'P-' || g, 1 + (g % 100)
       FROM generate_series(1, $2) g`,
      [accountId, N],
    );

    const start = performance.now();
    const page = await withTenant(accountId, (c) => listMatchesByScore(c, accountId, 20, 0));
    const elapsed = performance.now() - start;

    expect(page).toHaveLength(20);
    expect(page[0]!.match_score).toBeGreaterThanOrEqual(page[19]!.match_score);
    expect(elapsed).toBeLessThan(2000);
  });
});
