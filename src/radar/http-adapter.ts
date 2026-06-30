import { z } from 'zod';
import { childLogger } from '../core/logger.js';
import { ALLOW_ALL, parseRobots, type RobotsPolicy } from './robots.js';
import { RateLimiter } from './rate-limiter.js';
import type { RawListing, SourceAdapter } from './types.js';

const log = childLogger({ component: 'http-adapter' });

const RawListingSchema = z.object({
  sourceIdentifier: z.string().min(1),
  title: z.string().min(1),
  category: z.string().nullish(),
  region: z.string().nullish(),
  estimatedValue: z.union([z.number(), z.string()]).nullish(),
  deadline: z.string().nullish(),
  contactName: z.string().nullish(),
  contactEmail: z.string().nullish(),
  contactPhone: z.string().nullish(),
});

/**
 * Real Source_Portal adapter over HTTP (REQ 4.1, 4.2, 4.3). Fetches public listings
 * from a JSON endpoint, but only after:
 *   1. loading the portal's robots policy and confirming the path is allowed, and
 *   2. acquiring a per-portal rate-limit slot.
 * Disallowed paths are skipped and the exclusion is logged. A shared limiter spaces
 * requests across calls to the same portal.
 */
export class HttpSourceAdapter implements SourceAdapter {
  private readonly limiter = new RateLimiter();
  private readonly listingsPath: string;
  private readonly timeoutMs: number;

  constructor(opts: { listingsPath?: string; timeoutMs?: number } = {}) {
    this.listingsPath = opts.listingsPath ?? '/tenders.json';
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async loadPolicy(baseUrl: string, accessPolicyPath: string): Promise<RobotsPolicy> {
    try {
      const res = await this.fetchWithTimeout(`${baseUrl}${accessPolicyPath}`);
      if (!res.ok) return ALLOW_ALL;
      return parseRobots(await res.text());
    } catch {
      return ALLOW_ALL;
    }
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'TenderEdgeBot/1.0 (+public-tender-aggregation)' },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async fetchListings(portal: {
    name: string;
    baseUrl: string;
    rateLimitRpm: number;
    accessPolicyPath: string;
  }): Promise<RawListing[]> {
    const policy = await this.loadPolicy(portal.baseUrl, portal.accessPolicyPath);
    if (!policy.isAllowed(this.listingsPath)) {
      log.warn(
        { portal: portal.name, path: this.listingsPath },
        'access policy disallows path; skipping (REQ 4.3)',
      );
      return [];
    }

    await this.limiter.acquire(portal.name, portal.rateLimitRpm);

    const res = await this.fetchWithTimeout(`${portal.baseUrl}${this.listingsPath}`);
    if (!res.ok) throw new Error(`portal ${portal.name} returned HTTP ${res.status}`);

    const body = (await res.json()) as unknown;
    const items = Array.isArray(body) ? body : ((body as { tenders?: unknown[] }).tenders ?? []);
    const listings: RawListing[] = [];
    for (const item of items) {
      const parsed = RawListingSchema.safeParse(item);
      if (parsed.success) listings.push(parsed.data);
      else log.warn({ portal: portal.name, issues: parsed.error.issues }, 'skipping malformed listing');
    }
    return listings;
  }
}
