import {
  CATEGORY_ALIASES,
  CATEGORY_VOCABULARY,
  REGION_ALIASES,
  REGION_VOCABULARY,
} from '../config/platform.js';
import type { NormalizedTender, RawListing } from './types.js';

/**
 * Normalizes a Region value to the platform vocabulary (REQ 3.6). Lookup is
 * case-insensitive and consults aliases first, then the canonical vocabulary.
 * Returns null when the value cannot be mapped.
 */
export function normalizeRegion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in REGION_ALIASES) return REGION_ALIASES[key]!;
  if (key in REGION_VOCABULARY) return REGION_VOCABULARY[key]!;
  return null;
}

/** Normalizes a Product_Category to the platform vocabulary (REQ 3.6). */
export function normalizeCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in CATEGORY_ALIASES) return CATEGORY_ALIASES[key]!;
  if (key in CATEGORY_VOCABULARY) return CATEGORY_VOCABULARY[key]!;
  return null;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(?:(?:\+?\d{1,3}[\s-]?)?(?:\d[\s-]?){9,12}\d)/g;

/** Removes embedded emails/phone numbers from free text (REQ 4.5). */
export function scrubContactDetails(text: string): string {
  return text.replace(EMAIL_RE, '[redacted]').replace(PHONE_RE, '[redacted]').replace(/\s+/g, ' ').trim();
}

function parseValue(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,_\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  return n;
}

function parseDeadline(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/**
 * Parses + normalizes a raw listing into a canonical NormalizedTender (REQ 3.2, 3.5, 3.6, 4.5).
 * Missing or zero/negative estimated values and missing/invalid deadlines are marked
 * `unknown`. Personal contact details are never carried through.
 */
export function normalizeListing(
  sourcePortal: string,
  raw: RawListing,
  retrievedAt: string = new Date().toISOString(),
): NormalizedTender {
  const parsed = parseValue(raw.estimatedValue);
  // Quantize to the stored precision (numeric(18,2)) so normalize → store → parse round-trips exactly (RT1).
  const value = parsed === null ? null : Math.round(parsed * 100) / 100;
  const hasValue = value !== null && value > 0; // missing OR zero => unknown (REQ 3.5)
  const deadline = parseDeadline(raw.deadline);

  return {
    sourcePortal,
    sourceIdentifier: raw.sourceIdentifier,
    title: scrubContactDetails(raw.title),
    productCategory: normalizeCategory(raw.category),
    region: normalizeRegion(raw.region),
    estimatedValue: hasValue ? value : null,
    estimatedValueStatus: hasValue ? 'known' : 'unknown',
    deadline,
    deadlineStatus: deadline ? 'known' : 'unknown',
    retrievedAt,
  };
}

/** Serialized (storage) form of a normalized tender — mirrors the tender row. */
export interface StoredTender {
  source_portal: string;
  source_identifier: string;
  title: string;
  product_category: string | null;
  region: string | null;
  estimated_value: string | null; // numeric serialized as string
  estimated_value_status: 'known' | 'unknown';
  deadline: string | null;
  deadline_status: 'known' | 'unknown';
  retrieved_at: string;
}

/** Serializes a normalized tender to its stored representation (REQ 3.2 round-trip). */
export function toStored(t: NormalizedTender): StoredTender {
  return {
    source_portal: t.sourcePortal,
    source_identifier: t.sourceIdentifier,
    title: t.title,
    product_category: t.productCategory,
    region: t.region,
    estimated_value: t.estimatedValue === null ? null : t.estimatedValue.toFixed(2),
    estimated_value_status: t.estimatedValueStatus,
    deadline: t.deadline,
    deadline_status: t.deadlineStatus,
    retrieved_at: t.retrievedAt,
  };
}

/** Parses a stored representation back into a normalized tender (RT1). */
export function fromStored(s: StoredTender): NormalizedTender {
  return {
    sourcePortal: s.source_portal,
    sourceIdentifier: s.source_identifier,
    title: s.title,
    productCategory: s.product_category,
    region: s.region,
    estimatedValue: s.estimated_value === null ? null : Number(s.estimated_value),
    estimatedValueStatus: s.estimated_value_status,
    deadline: s.deadline,
    deadlineStatus: s.deadline_status,
    retrievedAt: s.retrieved_at,
  };
}
