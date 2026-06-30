import { childLogger } from '../core/logger.js';
import type { JobQueue } from '../queue/index.js';
import { loadPortalsConfig, type SourcePortalConfig } from '../config/portals.js';
import { recordPortalPollResult } from '../db/repositories/portals.js';
import { ingestListings, type IngestSummary, type OnTenderUpserted } from './aggregation.js';
import { HttpSourceAdapter } from './http-adapter.js';
import type { SourceAdapter } from './types.js';

const log = childLogger({ component: 'tender-radar' });

const POLL_JOB = 'radar.poll';

/**
 * Polls a single portal with per-portal failure isolation (REQ 3.4, 17.2): a failure
 * is recorded and logged, and never propagates to other portals. On success the
 * fetched listings are normalized and upserted by the Aggregation Engine.
 */
export async function pollPortal(
  adapter: SourceAdapter,
  portal: SourcePortalConfig,
  onUpserted?: OnTenderUpserted,
): Promise<IngestSummary | null> {
  try {
    const raws = await adapter.fetchListings({
      name: portal.name,
      baseUrl: portal.baseUrl,
      rateLimitRpm: portal.rateLimitRpm,
      accessPolicyPath: portal.accessPolicyPath,
    });
    const summary = await ingestListings(portal.name, raws, { onUpserted });
    await recordPortalPollResult(portal.name, 'ok', null);
    log.info({ portal: portal.name, ...summary }, 'portal poll complete');
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordPortalPollResult(portal.name, 'failed', message).catch(() => undefined);
    log.error({ portal: portal.name, err }, 'portal poll failed; other portals continue');
    return null;
  }
}

/** Polls every configured portal, isolating failures so one bad portal can't stop the rest. */
export async function pollAllPortals(
  adapter: SourceAdapter,
  portals: SourcePortalConfig[],
  onUpserted?: OnTenderUpserted,
): Promise<void> {
  for (const portal of portals) {
    await pollPortal(adapter, portal, onUpserted);
  }
}

export interface RadarOptions {
  adapter?: SourceAdapter;
  portals?: SourcePortalConfig[];
  onUpserted?: OnTenderUpserted;
}

/**
 * Registers the repeating poll job for each portal at its configured interval
 * (default 15 min, REQ 3.1). Scheduling uses a stable jobId per portal so a process
 * restart re-establishes the schedule automatically (REQ 17.3). An immediate poll is
 * enqueued per portal so coverage starts without waiting a full interval.
 */
export async function registerRadarJobs(queue: JobQueue, options: RadarOptions = {}): Promise<void> {
  const portals = options.portals ?? loadPortalsConfig();
  const adapter = options.adapter ?? new HttpSourceAdapter();
  const byName = new Map(portals.map((p) => [p.name, p]));

  queue.register<{ portalName: string }>(POLL_JOB, async ({ portalName }) => {
    const portal = byName.get(portalName);
    if (!portal) {
      log.warn({ portalName }, 'no config for scheduled portal; skipping');
      return;
    }
    await pollPortal(adapter, portal, options.onUpserted);
  });

  for (const portal of portals) {
    await queue.scheduleRepeating(
      POLL_JOB,
      { portalName: portal.name },
      { everyMs: portal.pollIntervalMinutes * 60_000, jobId: `radar:${portal.name}` },
    );
    await queue.enqueue(POLL_JOB, { portalName: portal.name });
  }
  log.info({ portals: portals.length }, 'tender radar scheduled');
}
