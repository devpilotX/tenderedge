import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateMatch, type ScorableFilter, type ScorableTender } from '../../src/match/scoring.js';
import { getTier } from '../../src/config/platform.js';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { upsertMatchFilter } from '../../src/db/repositories/match-filters.js';
import { upsertTender } from '../../src/db/repositories/tenders.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { evaluateTender } from '../../src/match/service.js';

const NOW = Date.parse('2026-06-30T00:00:00.000Z');

const tenderArb: fc.Arbitrary<ScorableTender> = fc.record({
  region: fc.option(fc.constantFrom('Patna', 'Gaya', 'Samastipur', 'Nowhere'), { nil: null }),
  productCategory: fc.option(fc.constantFrom('Mechanical Couplings', 'Pipes', 'Other'), { nil: null }),
  estimatedValue: fc.option(fc.double({ min: 0, max: 5_000_000, noNaN: true }), { nil: null }),
  estimatedValueStatus: fc.constantFrom('known', 'unknown'),
  deadline: fc.option(
    fc.date({ min: new Date('2026-01-01'), max: new Date('2027-12-31') }).map((d) => d.toISOString()),
    { nil: null },
  ),
  deadlineStatus: fc.constantFrom('known', 'unknown'),
  status: fc.constantFrom('open', 'closed'),
});

const filterArb: fc.Arbitrary<ScorableFilter> = fc.record({
  regions: fc.array(fc.constantFrom('Patna', 'Gaya', 'Samastipur', 'Muzaffarpur', 'Begusarai', 'Nalanda'), { maxLength: 8 }),
  productCategories: fc.array(fc.constantFrom('Mechanical Couplings', 'Pipes'), { maxLength: 3 }),
  minValue: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }),
  maxValue: fc.option(fc.integer({ min: 1_000_000, max: 5_000_000 }), { nil: null }),
});

describe('INV4 — Match_Score is always within [0,100]', () => {
  it('every evaluation yields a score in range, eligible or not', () => {
    fc.assert(
      fc.property(tenderArb, filterArb, fc.constantFrom(...(['basic', 'premium', 'enterprise'] as const)), (t, f, tierName) => {
        const e = evaluateMatch(t, f, getTier(tierName), NOW);
        return e.score >= 0 && e.score <= 100 && Number.isFinite(e.score);
      }),
      { numRuns: 500 },
    );
  });
});

describe('MM1 — a region outside the tier never increases match count', () => {
  it('appending a region beyond the tier cap does not add matches', () => {
    const tier = getTier('basic'); // cap 5
    fc.assert(
      fc.property(fc.array(tenderArb, { minLength: 1, maxLength: 20 }), (tenders) => {
        const base: ScorableFilter = {
          regions: ['Patna', 'Gaya', 'Samastipur', 'Muzaffarpur', 'Begusarai'],
          productCategories: [],
          minValue: null,
          maxValue: null,
        };
        const augmented: ScorableFilter = { ...base, regions: [...base.regions, 'Nalanda'] };
        const countBase = tenders.filter((t) => evaluateMatch(t, base, tier, NOW).eligible).length;
        const countAug = tenders.filter((t) => evaluateMatch(t, augmented, tier, NOW).eligible).length;
        return countAug <= countBase;
      }),
      { numRuns: 200 },
    );
  });
});

describe('ID2 — re-evaluating an unchanged tender is idempotent', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('produces the same match set and scores across two evaluations', async () => {
    const { tender } = await withSystem(async (client) => {
      const a1 = await createBusinessAccount(client, { name: 'Acct1', tier: 'premium' });
      const a2 = await createBusinessAccount(client, { name: 'Acct2', tier: 'premium' });
      for (const id of [a1.id, a2.id]) {
        await upsertMatchFilter(client, id, {
          regions: ['Patna'],
          productCategories: ['Mechanical Couplings'],
          minValue: null,
          maxValue: null,
        });
      }
      const up = await upsertTender(
        client,
        toStored(
          normalizeListing(
            'PortalA',
            { sourceIdentifier: 'M-1', title: 'Couplings', category: 'couplings', region: 'Patna', estimatedValue: 400000, deadline: '2027-01-01T00:00:00.000Z' },
            '2026-06-30T00:00:00.000Z',
          ),
        ),
      );
      return { tender: up.tender };
    });

    const first = await evaluateTender(tender, { nowMs: NOW });
    const second = await evaluateTender(tender, { nowMs: NOW });

    const sortKey = (a: { businessAccountId: string }) => a.businessAccountId;
    first.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    second.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));

    expect(first.length).toBe(2);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
