import { withSystem, withTenant } from '../db/pool.js';
import { getTier, type SubscriptionTierName } from '../config/platform.js';
import { TierLimitError } from '../core/errors.js';
import { runWrite } from '../auth/rbac.js';
import type { Tender, UserRole } from '../db/entities.js';
import {
  getMatchFilter,
  upsertMatchFilter,
  type MatchFilterInput,
} from '../db/repositories/match-filters.js';
import {
  deleteMatch,
  listMatchesByScore,
  removeExpiredMatches as removeExpiredMatchesRepo,
  upsertMatch,
  type MatchWithTender,
} from '../db/repositories/matches.js';
import { evaluateMatch, type ScorableTender } from './scoring.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'smart-match' });

function tenderToScorable(t: Tender): ScorableTender {
  return {
    region: t.region,
    productCategory: t.product_category,
    estimatedValue: t.estimated_value === null ? null : Number(t.estimated_value),
    estimatedValueStatus: t.estimated_value_status,
    deadline: t.deadline ? new Date(t.deadline).toISOString() : null,
    deadlineStatus: t.deadline_status,
    status: t.status,
  };
}

/**
 * Configures the account's Smart Match filter (REQ 5.1). Rejects selecting more
 * Regions than the tier allows (REQ 14.3). Write-gated (viewer cannot configure).
 */
export async function configureFilters(
  accountId: string,
  role: UserRole,
  tier: SubscriptionTierName,
  input: MatchFilterInput,
): Promise<void> {
  await runWrite(role, async () => {
    const max = getTier(tier).maxRegions;
    if (input.regions.length > max) {
      throw new TierLimitError(
        `Your ${tier} plan allows up to ${max} regions; you selected ${input.regions.length}.`,
      );
    }
    await withTenant(accountId, (c) => upsertMatchFilter(c, accountId, input));
  });
}

export async function getFilters(accountId: string) {
  return withTenant(accountId, (c) => getMatchFilter(c, accountId));
}

export interface AffectedMatch {
  businessAccountId: string;
  sourcePortal: string;
  sourceIdentifier: string;
  matchScore: number;
}

/** Hook invoked for each account a tender newly matches (Realtime Hub plugs in here). */
export type OnMatched = (m: AffectedMatch) => Promise<void> | void;

/**
 * Evaluates one tender against every configured account (REQ 5.2, 5.3, 5.5). For
 * each account it joins the account's tier, scores the tender, and upserts a match
 * when eligible or removes a stale match when not. Deterministic given `nowMs` (ID2).
 * Runs in the system context (cross-tenant).
 */
export async function evaluateTender(
  tender: Tender,
  options: { nowMs?: number; onMatched?: OnMatched } = {},
): Promise<AffectedMatch[]> {
  const nowMs = options.nowMs ?? Date.now();
  const scorable = tenderToScorable(tender);
  const affected: AffectedMatch[] = [];

  await withSystem(async (client) => {
    const { rows } = await client.query<{
      business_account_id: string;
      regions: string[];
      product_categories: string[];
      min_value: string | null;
      max_value: string | null;
      subscription_tier: SubscriptionTierName;
    }>(
      `SELECT mf.business_account_id, mf.regions, mf.product_categories,
              mf.min_value, mf.max_value, ba.subscription_tier
       FROM match_filter mf
       JOIN business_account ba ON ba.id = mf.business_account_id
       WHERE ba.status <> 'suspended'`,
    );

    for (const r of rows) {
      const evaln = evaluateMatch(
        scorable,
        {
          regions: r.regions,
          productCategories: r.product_categories,
          minValue: r.min_value === null ? null : Number(r.min_value),
          maxValue: r.max_value === null ? null : Number(r.max_value),
        },
        getTier(r.subscription_tier),
        nowMs,
      );

      if (evaln.eligible) {
        await upsertMatch(client, {
          businessAccountId: r.business_account_id,
          sourcePortal: tender.source_portal,
          sourceIdentifier: tender.source_identifier,
          matchScore: evaln.score,
        });
        affected.push({
          businessAccountId: r.business_account_id,
          sourcePortal: tender.source_portal,
          sourceIdentifier: tender.source_identifier,
          matchScore: evaln.score,
        });
      } else {
        await deleteMatch(client, {
          businessAccountId: r.business_account_id,
          sourcePortal: tender.source_portal,
          sourceIdentifier: tender.source_identifier,
        });
      }
    }
  });

  if (options.onMatched) {
    for (const m of affected) await options.onMatched(m);
  }
  log.debug({ tender: tender.source_identifier, affected: affected.length }, 'evaluated tender');
  return affected;
}

/** Ranked matched tenders for an account (REQ 5.4), paginated. */
export async function listMatches(
  accountId: string,
  page = 1,
  pageSize = 20,
): Promise<MatchWithTender[]> {
  const limit = Math.min(Math.max(pageSize, 1), 100);
  const offset = Math.max(page - 1, 0) * limit;
  return withTenant(accountId, (c) => listMatchesByScore(c, accountId, limit, offset));
}

/** Removes matches whose tenders have expired or closed (REQ 5.6). */
export async function pruneExpiredMatches(): Promise<number> {
  return withSystem((c) => removeExpiredMatchesRepo(c));
}
