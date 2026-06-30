import fc from 'fast-check';
import { describe, it, expect, beforeEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { upsertTender, getTender, countTenders } from '../../src/db/repositories/tenders.js';
import type { RawListing } from '../../src/radar/types.js';

const RETRIEVED_AT = '2026-06-30T00:00:00.000Z';

/**
 * ID1 + INV2: upserting the same unchanged listing twice leaves exactly one tender
 * whose business fields equal a single upsert. (REQ 3.3)
 */
describe('ID1 / INV2 — upsert idempotence & dedup', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('two upserts of the same listing produce one row, identical in business fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record(
          {
            sourceIdentifier: fc.string({ minLength: 1, maxLength: 20 }),
            title: fc.string({ maxLength: 40 }),
            category: fc.constantFrom('couplings', 'Pipes', 'mystery'),
            region: fc.constantFrom('Patna', 'gaya', 'Atlantis'),
            estimatedValue: fc.oneof(fc.integer({ min: 0, max: 1_000_000 }), fc.constant(null)),
            deadline: fc.constantFrom('2027-03-01T00:00:00.000Z', null),
          },
          { requiredKeys: ['sourceIdentifier', 'title'] },
        ),
        async (raw: RawListing) => {
          await resetData();
          const stored = toStored(normalizeListing('PortalA', raw, RETRIEVED_AT));

          const { first, second, count } = await withSystem(async (client) => {
            const r1 = await upsertTender(client, stored);
            const r2 = await upsertTender(client, stored);
            const c = await countTenders(client);
            return { first: r1, second: r2, count: c };
          });

          if (!first.inserted) return false;
          if (second.inserted) return false;
          if (count !== 1) return false;

          const proj = (t: typeof first.tender) => ({
            title: t.title,
            product_category: t.product_category,
            region: t.region,
            estimated_value: t.estimated_value,
            estimated_value_status: t.estimated_value_status,
            deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
            deadline_status: t.deadline_status,
          });
          return JSON.stringify(proj(first.tender)) === JSON.stringify(proj(second.tender));
        },
      ),
      { numRuns: 15 },
    );
  });

  it('preserves an existing complete field when a later update omits it (REQ 3.5)', async () => {
    await resetData();
    const complete = toStored(
      normalizeListing(
        'PortalA',
        { sourceIdentifier: 'T-1', title: 'Couplings', category: 'couplings', region: 'Patna', estimatedValue: 500000, deadline: '2027-03-01T00:00:00.000Z' },
        RETRIEVED_AT,
      ),
    );
    const incomplete = toStored(
      normalizeListing(
        'PortalA',
        { sourceIdentifier: 'T-1', title: 'Couplings (updated)', category: null, region: null, estimatedValue: 0, deadline: null },
        RETRIEVED_AT,
      ),
    );

    const tender = await withSystem(async (client) => {
      await upsertTender(client, complete);
      await upsertTender(client, incomplete);
      return getTender(client, 'PortalA', 'T-1');
    });

    expect(tender?.title).toBe('Couplings (updated)');
    expect(tender?.product_category).toBe('Mechanical Couplings');
    expect(tender?.region).toBe('Patna');
    expect(tender?.estimated_value_status).toBe('known');
    expect(Number(tender?.estimated_value)).toBe(500000);
    expect(tender?.deadline_status).toBe('known');
  });
});
