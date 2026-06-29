/**
 * Platform-wide business configuration: subscription tiers/entitlements,
 * controlled vocabularies for normalization, and default intervals.
 * These are product rules (not secrets) and are safe to keep in source.
 */

export type SubscriptionTierName = 'basic' | 'premium' | 'enterprise';

export interface TierDefinition {
  readonly name: SubscriptionTierName;
  readonly label: string;
  /** Maximum number of Regions a Business_Account on this tier may track. */
  readonly maxRegions: number;
  /** Whether Bid_Brain price prediction is enabled. */
  readonly bidBrainEnabled: boolean;
  /** Monthly price in minor currency units (paise). */
  readonly monthlyPricePaise: number;
}

export const TIERS: Readonly<Record<SubscriptionTierName, TierDefinition>> = {
  basic: {
    name: 'basic',
    label: 'Basic',
    maxRegions: 5,
    bidBrainEnabled: false,
    monthlyPricePaise: 499_00,
  },
  premium: {
    name: 'premium',
    label: 'Premium',
    maxRegions: 20,
    bidBrainEnabled: true,
    monthlyPricePaise: 1_999_00,
  },
  enterprise: {
    name: 'enterprise',
    label: 'Enterprise',
    maxRegions: 100,
    bidBrainEnabled: true,
    monthlyPricePaise: 9_999_00,
  },
};

export function getTier(name: SubscriptionTierName): TierDefinition {
  return TIERS[name];
}

/**
 * Controlled vocabulary for Region normalization (city/district level).
 * Aliases map raw source values to the canonical region key.
 */
export const REGION_VOCABULARY: Readonly<Record<string, string>> = {
  patna: 'Patna',
  gaya: 'Gaya',
  samastipur: 'Samastipur',
  muzaffarpur: 'Muzaffarpur',
  bhagalpur: 'Bhagalpur',
  darbhanga: 'Darbhanga',
  nalanda: 'Nalanda',
  begusarai: 'Begusarai',
  purnia: 'Purnia',
  arrah: 'Arrah',
};

export const REGION_ALIASES: Readonly<Record<string, string>> = {
  'patna sadar': 'Patna',
  'patna district': 'Patna',
  'gaya district': 'Gaya',
  bodhgaya: 'Gaya',
  'muzaffarpur district': 'Muzaffarpur',
};

/** Controlled vocabulary for Product_Category normalization. */
export const CATEGORY_VOCABULARY: Readonly<Record<string, string>> = {
  'mechanical couplings': 'Mechanical Couplings',
  pipes: 'Pipes',
  'di pipe fittings': 'DI Pipe Fittings',
  valves: 'Industrial Valves',
  'industrial valves': 'Industrial Valves',
  flanges: 'Flanges & Gaskets',
  'flanges and gaskets': 'Flanges & Gaskets',
  pumps: 'Pumps',
  gaskets: 'Flanges & Gaskets',
};

export const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  coupling: 'Mechanical Couplings',
  couplings: 'Mechanical Couplings',
  'pipe fittings': 'DI Pipe Fittings',
  'ductile iron pipe fittings': 'DI Pipe Fittings',
  valve: 'Industrial Valves',
  flange: 'Flanges & Gaskets',
  pump: 'Pumps',
};

/** Default deadline reminder offsets in days (REQ 8.2, 8.3). */
export const DEFAULT_REMINDER_DAYS: readonly number[] = [7, 1];

/** Grace period (hours) after deadline before a pursued tender is auto-closed (REQ 8.5). */
export const DEFAULT_GRACE_PERIOD_HOURS = 24;

/** Document expiry reminder threshold in days (REQ 9.4). */
export const DOCUMENT_EXPIRY_REMINDER_DAYS = 30;

/** Maximum Business_Document size in bytes (REQ 9.6: 50 MB). */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** Minimum matching Historical_Tender_Records for a prediction (REQ 7.5). */
export const MIN_HISTORICAL_RECORDS_FOR_PREDICTION = 10;

/** Historical record retention in years (REQ 6.2). */
export const HISTORICAL_RETENTION_YEARS = 5;

/** Billing retry policy (REQ 13.4). */
export const BILLING_MAX_RETRIES = 3;
export const BILLING_RETRY_WINDOW_DAYS = 7;

/** Notification retry policy (REQ 12.3). */
export const NOTIFICATION_MAX_RETRIES = 3;
