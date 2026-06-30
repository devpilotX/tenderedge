import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { computePrediction } from '../../src/bidbrain/predict.js';
import { recordOutcome, predict } from '../../src/bidbrain/service.js';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { upsertTender } from '../../src/db/repositories/tenders.js';
import { insertHistoricalRecord } from '../../src/db/repositories/historical.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { NotEntitledError } from '../../src/core/errors.js';

const priceArb = fc.double({ min: 1000, max: 5_000_000, noNaN: true, noDefaultInfinity: true });

describe('INV3 — prediction bounds & confidence range', () => {
  it('lower <= upper and 0 <= confidence <= 1 for any sample', () => {
    fc.assert(
      fc.property(fc.array(priceArb, { maxLength: 80 }), (prices) => {
        const r = computePrediction(prices);
        return (
          r.lower <= r.upper &&
          r.confidence >= 0 &&
          r.confidence <= 1 &&
          Number.isFinite(r.confidence)
        );
      }),
      { numRuns: 500 },
    );
  });
});

describe('MM2 — more matching records never flip a sufficient prediction to insufficient', () => {
  it('a superset of prices stays "ok" once "ok"', () => {
    fc.assert(
      fc.property(
        fc.array(priceArb, { minLength: 10, maxLength: 40 }),
        fc.array(priceArb, { maxLength: 40 }),
        (base, extra) => {
          const baseResult = computePrediction(base);
          const augmented = computePrediction([...base, ...extra]);
          if (baseResult.status === 'ok') return augmented.status === 'ok';
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Bid Brain service (entitlement, data sufficiency)', () => {
  beforeEach(async () => {
    await resetData();
  });

  async function seedTender(category: string, region: string) {
    await withSystem((c) =>
      upsertTender(
        c,
        toStored(
          normalizeListing(
            'PortalA',
            { sourceIdentifier: 'BB-1', title: 'Couplings', category, region, estimatedValue: 500000, deadline: '2027-06-01T00:00:00.000Z' },
            '2026-06-30T00:00:00.000Z',
          ),
        ),
      ),
    );
  }

  it('denies prediction for a non-entitled (basic) account (REQ 7.2, ERR3)', async () => {
    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'B', tier: 'basic' })).id);
    await seedTender('couplings', 'Patna');
    await expect(
      predict({ accountId, tier: 'basic', sourcePortal: 'PortalA', sourceIdentifier: 'BB-1' }),
    ).rejects.toBeInstanceOf(NotEntitledError);
  });

  it('returns insufficient-data when fewer than 10 matching records exist (REQ 7.5)', async () => {
    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'P', tier: 'premium' })).id);
    await seedTender('couplings', 'Patna');
    await withSystem(async (c) => {
      for (let i = 0; i < 5; i++) {
        await insertHistoricalRecord(c, {
          productCategory: 'Mechanical Couplings',
          region: 'Patna',
          sourcePortal: 'PortalA',
          sourceIdentifier: `H-${i}`,
          awardedPrice: 400000 + i * 1000,
          closedAt: '2026-01-01T00:00:00.000Z',
        });
      }
    });
    const result = await predict({ accountId, tier: 'premium', sourcePortal: 'PortalA', sourceIdentifier: 'BB-1' });
    expect(result.status).toBe('insufficient_data');
  });

  it('produces a bounded prediction with >= 10 matching records (REQ 7.3, 7.6)', async () => {
    const accountId = await withSystem(async (c) => (await createBusinessAccount(c, { name: 'P', tier: 'premium' })).id);
    await seedTender('couplings', 'Patna');
    await withSystem(async (c) => {
      for (let i = 0; i < 12; i++) {
        await insertHistoricalRecord(c, {
          productCategory: 'Mechanical Couplings',
          region: 'Patna',
          sourcePortal: 'PortalA',
          sourceIdentifier: `H-${i}`,
          awardedPrice: 350000 + i * 5000,
          closedAt: '2026-01-01T00:00:00.000Z',
        });
      }
    });
    const result = await predict({ accountId, tier: 'premium', sourcePortal: 'PortalA', sourceIdentifier: 'BB-1' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.lower).toBeLessThanOrEqual(result.upper);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.sampleSize).toBe(12);
    }
  });

  it('records a closed-tender outcome with unknown price when none is available (REQ 6.4)', async () => {
    await recordOutcome({
      productCategory: 'Pipes',
      region: 'Gaya',
      sourcePortal: 'PortalA',
      sourceIdentifier: 'X-9',
      awardedPrice: 0,
      closedAt: '2026-02-01T00:00:00.000Z',
    });
    const count = await withSystem(async (c) => {
      const { rows } = await c.query<{ c: string }>(
        `SELECT count(*) c FROM historical_tender_record WHERE awarded_price_status = 'unknown'`,
      );
      return Number(rows[0]!.c);
    });
    expect(count).toBe(1);
  });
});
