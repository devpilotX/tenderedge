/**
 * Tender Radar domain types.
 *
 * A SourceAdapter fetches RawListings from a Source_Portal. The Aggregation Engine
 * normalizes each RawListing into a NormalizedTender (vocabulary-mapped, with
 * missing/zero fields marked unknown and personal contact details stripped) before
 * upserting it. The adapter is an interface so the real HTTP implementation and
 * deterministic test fakes are interchangeable.
 */
export interface RawListing {
  sourceIdentifier: string;
  title: string;
  category?: string | null;
  region?: string | null;
  estimatedValue?: number | string | null;
  deadline?: string | null;
  // Fields below are intentionally NOT persisted (REQ 4.5 — exclude personal contact details).
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export type KnownStatus = 'known' | 'unknown';

export interface NormalizedTender {
  sourcePortal: string;
  sourceIdentifier: string;
  title: string;
  productCategory: string | null;
  region: string | null;
  estimatedValue: number | null;
  estimatedValueStatus: KnownStatus;
  deadline: string | null; // ISO 8601, or null when unknown
  deadlineStatus: KnownStatus;
  retrievedAt: string; // ISO 8601
}

export interface SourceAdapter {
  /** Fetches the current public listings for a portal. Applies policy + rate limits. */
  fetchListings(portal: {
    name: string;
    baseUrl: string;
    rateLimitRpm: number;
    accessPolicyPath: string;
  }): Promise<RawListing[]>;
}
