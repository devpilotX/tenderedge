import type { PoolClient } from 'pg';
import type { Tender, TenderMatch } from '../entities.js';

/** A match row joined with its tender, for ranked listings and the dashboard. */
export interface MatchWithTender extends TenderMatch {
  tender: Tender;
}

/**
 * Upserts a match for (account, tender), keeping the latest score. Unique on
 * (business_account_id, tender identity) prevents duplicate matches.
 */
export async function upsertMatch(
  client: PoolClient,
  params: {
    businessAccountId: string;
    sourcePortal: string;
    sourceIdentifier: string;
    matchScore: number;
  },
): Promise<TenderMatch> {
  const { rows } = await client.query<TenderMatch>(
    `INSERT INTO tender_match
       (business_account_id, tender_source_portal, tender_source_identifier, match_score)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (business_account_id, tender_source_portal, tender_source_identifier)
       DO UPDATE SET match_score = EXCLUDED.match_score
     RETURNING *`,
    [params.businessAccountId, params.sourcePortal, params.sourceIdentifier, params.matchScore],
  );
  return rows[0]!;
}

export async function deleteMatch(
  client: PoolClient,
  params: { businessAccountId: string; sourcePortal: string; sourceIdentifier: string },
): Promise<void> {
  await client.query(
    `DELETE FROM tender_match
     WHERE business_account_id = $1 AND tender_source_portal = $2 AND tender_source_identifier = $3`,
    [params.businessAccountId, params.sourcePortal, params.sourceIdentifier],
  );
}

export async function countMatches(
  client: PoolClient,
  businessAccountId: string,
): Promise<number> {
  const { rows } = await client.query<{ c: string }>(
    `SELECT count(*) c FROM tender_match WHERE business_account_id = $1`,
    [businessAccountId],
  );
  return Number(rows[0]!.c);
}

/** Matched tenders ordered by descending Match_Score (REQ 5.4), paginated. */
export async function listMatchesByScore(
  client: PoolClient,
  businessAccountId: string,
  limit: number,
  offset: number,
): Promise<MatchWithTender[]> {
  const { rows } = await client.query(
    `SELECT m.*, row_to_json(t.*) AS tender
     FROM tender_match m
     JOIN tender t
       ON t.source_portal = m.tender_source_portal
      AND t.source_identifier = m.tender_source_identifier
     WHERE m.business_account_id = $1
     ORDER BY m.match_score DESC, m.created_at DESC
     LIMIT $2 OFFSET $3`,
    [businessAccountId, limit, offset],
  );
  return rows as MatchWithTender[];
}

/**
 * Removes matches whose tender has passed its deadline or is closed (REQ 5.6).
 * Runs in the system context across all accounts. Returns the number removed.
 */
export async function removeExpiredMatches(client: PoolClient): Promise<number> {
  const res = await client.query(
    `DELETE FROM tender_match m
     USING tender t
     WHERE t.source_portal = m.tender_source_portal
       AND t.source_identifier = m.tender_source_identifier
       AND (t.status = 'closed' OR (t.deadline_status = 'known' AND t.deadline < now()))`,
  );
  return res.rowCount ?? 0;
}
