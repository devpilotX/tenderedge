import { describe, it, expect, beforeEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { upsertTender } from '../../src/db/repositories/tenders.js';
import { upsertMatch } from '../../src/db/repositories/matches.js';
import { pursueTender } from '../../src/db/repositories/pursued.js';
import { upsertPrediction } from '../../src/db/repositories/predictions.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { getDashboard } from '../../src/dashboard/service.js';

const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
const far = new Date(Date.now() + 40 * 86_400_000).toISOString();

async function seed(): Promise<string> {
  return withSystem(async (c) => {
    const acct = await createBusinessAccount(c, { name: 'Sharma Couplings', tier: 'premium' });
    for (const [id, value, deadline] of [
      ['T1', 500000, soon],
      ['T2', 1000000, far],
    ] as const) {
      await upsertTender(
        c,
        toStored(normalizeListing('PortalA', { sourceIdentifier: id, title: `Tender ${id}`, category: 'couplings', region: 'Patna', estimatedValue: value, deadline }, '2026-06-30T00:00:00.000Z')),
      );
    }
    await upsertMatch(c, { businessAccountId: acct.id, sourcePortal: 'PortalA', sourceIdentifier: 'T1', matchScore: 80 });
    await pursueTender(c, { businessAccountId: acct.id, sourcePortal: 'PortalA', sourceIdentifier: 'T1', trackedDeadline: soon, reminderOffsetsDays: null, stage: 'preparing' });
    await pursueTender(c, { businessAccountId: acct.id, sourcePortal: 'PortalA', sourceIdentifier: 'T2', trackedDeadline: far, reminderOffsetsDays: null, stage: 'won' });
    await upsertPrediction(c, { businessAccountId: acct.id, sourcePortal: 'PortalA', sourceIdentifier: 'T1', lowerBound: 450000, upperBound: 520000, confidence: 0.8, sampleSize: 12 });
    return acct.id;
  });
}

describe('Dashboard aggregation (REQ 10)', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('aggregates KPIs, pipeline by stage, actions by deadline, and gated predictions', async () => {
    const accountId = await seed();
    const d = await getDashboard(accountId, 'premium');

    expect(d.kpis.liveMatchedTenders).toBe(1);
    expect(d.kpis.avgWinChance).toBe(80);
    expect(d.kpis.moneyPipelineTotal).toBe(1_500_000);
    expect(d.kpis.deadlinesThisWeek).toBe(1);

    const stages = Object.fromEntries(d.moneyPipeline.map((s) => [s.stage, s.totalValue]));
    expect(stages.preparing).toBe(500000);
    expect(stages.won).toBe(1_000_000);

    expect(d.matchedTenders[0]?.winChance).toBe(80);
    expect(d.recommendedActions[0]?.sourceIdentifier).toBe('T1');

    expect(d.bidBrainEnabled).toBe(true);
    expect(d.predictions).toHaveLength(1);
  });

  it('omits predictions when the tier does not enable Bid Brain (REQ 10.5)', async () => {
    const accountId = await seed();
    const d = await getDashboard(accountId, 'basic');
    expect(d.bidBrainEnabled).toBe(false);
    expect(d.predictions).toHaveLength(0);
  });
});
