import type { PoolClient } from 'pg';
import { withSystem } from '../db/pool.js';
import { upsertTender } from '../db/repositories/tenders.js';
import type { Tender } from '../db/entities.js';
import { childLogger } from '../core/logger.js';
import { normalizeListing, toStored } from './normalize.js';
import type { RawListing } from './types.js';

const log = childLogger({ component: 'aggregation' });

/** Called after each successful upsert (Smart Match hooks in here in Task 5). */
export type OnTenderUpserted = (tender: Tender, inserted: boolean) => Promise<void> | void;

export interface IngestSummary {
  created: number;
  updated: number;
  total: number;
}

/**
 * Parses, normalizes, deduplicates, and upserts a batch of raw listings for one
 * portal (REQ 3.2, 3.3, 3.5, 3.6, 4.4). All upserts share one system-context
 * transaction so a portal's batch is atomic. The optional hook lets downstream
 * services (Smart Match, Realtime Hub) react to each stored tender.
 */
export async function ingestListings(
  sourcePortal: string,
  raws: RawListing[],
  options: { retrievedAt?: string; onUpserted?: OnTenderUpserted } = {},
): Promise<IngestSummary> {
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  return withSystem(async (client: PoolClient) => {
    let created = 0;
    let updated = 0;
    for (const raw of raws) {
      const normalized = normalizeListing(sourcePortal, raw, retrievedAt);
      const { tender, inserted } = await upsertTender(client, toStored(normalized));
      if (inserted) created += 1;
      else updated += 1;
      if (options.onUpserted) await options.onUpserted(tender, inserted);
    }
    log.debug({ sourcePortal, created, updated }, 'ingested listings');
    return { created, updated, total: raws.length };
  });
}
