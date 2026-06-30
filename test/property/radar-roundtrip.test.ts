import fc from 'fast-check';
import { describe, it } from 'vitest';
import { fromStored, normalizeListing, toStored } from '../../src/radar/normalize.js';
import type { RawListing } from '../../src/radar/types.js';

/**
 * RT1: parsing a listing, serializing the normalized Tender, then re-parsing yields
 * an equivalent normalized Tender. Normalization is deterministic and the stored
 * representation is a faithful, lossless encoding at the stored precision. (REQ 3.2, 3.6)
 */
const rawArb: fc.Arbitrary<RawListing> = fc.record(
  {
    sourceIdentifier: fc.string({ minLength: 1, maxLength: 24 }),
    title: fc.string({ maxLength: 60 }),
    category: fc.option(
      fc.oneof(fc.constantFrom('couplings', 'Pipes', 'valves', 'flange', 'mystery-cat'), fc.string()),
      { nil: null },
    ),
    region: fc.option(
      fc.oneof(fc.constantFrom('Patna', 'bodhgaya', 'gaya', 'Atlantis'), fc.string()),
      { nil: null },
    ),
    estimatedValue: fc.option(
      fc.oneof(
        fc.double({ min: -1000, max: 5_000_000, noNaN: true, noDefaultInfinity: true }),
        fc.integer({ min: 0, max: 9_000_000 }).map((n) => String(n)),
      ),
      { nil: null },
    ),
    deadline: fc.option(
      fc.oneof(
        fc.constantFrom('2027-01-15T00:00:00.000Z', 'not-a-date', ''),
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }).map((d) => d.toISOString()),
      ),
      { nil: null },
    ),
  },
  { requiredKeys: ['sourceIdentifier', 'title'] },
);

describe('RT1 — scraper parse/normalize/serialize round-trip', () => {
  it('normalize → serialize → parse yields an equivalent normalized tender', () => {
    fc.assert(
      fc.property(rawArb, (raw) => {
        const n1 = normalizeListing('PortalA', raw, '2026-06-30T00:00:00.000Z');
        const n2 = fromStored(toStored(n1));
        return JSON.stringify(n1) === JSON.stringify(n2);
      }),
      { numRuns: 300 },
    );
  });
});
