import { withTenant } from '../db/pool.js';
import { getTier, type SubscriptionTierName } from '../config/platform.js';

export interface DashboardMatchedTender {
  sourcePortal: string;
  sourceIdentifier: string;
  title: string;
  region: string | null;
  estimatedValue: number | null;
  winChance: number; // = Match_Score
  deadline: string | null;
}

export interface PipelineStage {
  stage: string;
  count: number;
  totalValue: number;
}

export interface RecommendedAction {
  sourcePortal: string;
  sourceIdentifier: string;
  title: string;
  stage: string;
  deadline: string | null;
}

export interface DashboardPrediction {
  sourcePortal: string;
  sourceIdentifier: string;
  lower: number;
  upper: number;
  confidence: number;
}

export interface DashboardSummary {
  kpis: {
    liveMatchedTenders: number;
    avgWinChance: number;
    moneyPipelineTotal: number;
    deadlinesThisWeek: number;
  };
  matchedTenders: DashboardMatchedTender[];
  moneyPipeline: PipelineStage[];
  recommendedActions: RecommendedAction[];
  bidBrainEnabled: boolean;
  predictions: DashboardPrediction[];
}

/**
 * Assembles the dashboard summary for an account (REQ 10.1–10.5). All reads run in
 * the tenant context, so RLS guarantees account scoping. Predictions are included
 * only when the account's tier enables Bid Brain (REQ 10.5).
 */
export async function getDashboard(
  accountId: string,
  tier: SubscriptionTierName,
): Promise<DashboardSummary> {
  const bidBrainEnabled = getTier(tier).bidBrainEnabled;

  return withTenant(accountId, async (c) => {
    const matched = await c.query<{
      tender_source_portal: string;
      tender_source_identifier: string;
      match_score: number;
      title: string;
      region: string | null;
      estimated_value: string | null;
      deadline: Date | null;
    }>(
      `SELECT m.tender_source_portal, m.tender_source_identifier, m.match_score,
              t.title, t.region, t.estimated_value, t.deadline
       FROM tender_match m
       JOIN tender t ON t.source_portal = m.tender_source_portal
                    AND t.source_identifier = m.tender_source_identifier
       WHERE m.business_account_id = $1
       ORDER BY m.match_score DESC, m.created_at DESC
       LIMIT 25`,
      [accountId],
    );

    const pipeline = await c.query<{ stage: string; count: string; total: string }>(
      `SELECT pt.stage, count(*) AS count, COALESCE(SUM(t.estimated_value), 0) AS total
       FROM pursued_tender pt
       JOIN tender t ON t.source_portal = pt.tender_source_portal
                    AND t.source_identifier = pt.tender_source_identifier
       WHERE pt.business_account_id = $1 AND pt.closed_at IS NULL
       GROUP BY pt.stage`,
      [accountId],
    );

    const actions = await c.query<{
      tender_source_portal: string;
      tender_source_identifier: string;
      title: string;
      stage: string;
      tracked_deadline: Date | null;
    }>(
      `SELECT pt.tender_source_portal, pt.tender_source_identifier, t.title, pt.stage, pt.tracked_deadline
       FROM pursued_tender pt
       JOIN tender t ON t.source_portal = pt.tender_source_portal
                    AND t.source_identifier = pt.tender_source_identifier
       WHERE pt.business_account_id = $1 AND pt.closed_at IS NULL AND pt.tracked_deadline IS NOT NULL
       ORDER BY pt.tracked_deadline ASC
       LIMIT 10`,
      [accountId],
    );

    const kpi = await c.query<{ live: string; avg_score: string | null; deadlines_week: string }>(
      `SELECT
         (SELECT count(*) FROM tender_match WHERE business_account_id = $1) AS live,
         (SELECT avg(match_score) FROM tender_match WHERE business_account_id = $1) AS avg_score,
         (SELECT count(*) FROM pursued_tender
            WHERE business_account_id = $1 AND closed_at IS NULL
              AND tracked_deadline IS NOT NULL
              AND tracked_deadline <= now() + interval '7 days') AS deadlines_week`,
      [accountId],
    );

    let predictions: DashboardPrediction[] = [];
    if (bidBrainEnabled) {
      const preds = await c.query<{
        tender_source_portal: string;
        tender_source_identifier: string;
        lower_bound: string;
        upper_bound: string;
        confidence: string;
      }>(
        `SELECT pp.tender_source_portal, pp.tender_source_identifier, pp.lower_bound, pp.upper_bound, pp.confidence
         FROM price_prediction pp
         WHERE pp.business_account_id = $1`,
        [accountId],
      );
      predictions = preds.rows.map((p) => ({
        sourcePortal: p.tender_source_portal,
        sourceIdentifier: p.tender_source_identifier,
        lower: Number(p.lower_bound),
        upper: Number(p.upper_bound),
        confidence: Number(p.confidence),
      }));
    }

    const moneyPipeline: PipelineStage[] = pipeline.rows.map((r) => ({
      stage: r.stage,
      count: Number(r.count),
      totalValue: Number(r.total),
    }));

    return {
      kpis: {
        liveMatchedTenders: Number(kpi.rows[0]!.live),
        avgWinChance: Math.round(Number(kpi.rows[0]!.avg_score ?? 0)),
        moneyPipelineTotal: moneyPipeline.reduce((s, p) => s + p.totalValue, 0),
        deadlinesThisWeek: Number(kpi.rows[0]!.deadlines_week),
      },
      matchedTenders: matched.rows.map((m) => ({
        sourcePortal: m.tender_source_portal,
        sourceIdentifier: m.tender_source_identifier,
        title: m.title,
        region: m.region,
        estimatedValue: m.estimated_value === null ? null : Number(m.estimated_value),
        winChance: m.match_score,
        deadline: m.deadline ? new Date(m.deadline).toISOString() : null,
      })),
      moneyPipeline,
      recommendedActions: actions.rows.map((a) => ({
        sourcePortal: a.tender_source_portal,
        sourceIdentifier: a.tender_source_identifier,
        title: a.title,
        stage: a.stage,
        deadline: a.tracked_deadline ? new Date(a.tracked_deadline).toISOString() : null,
      })),
      bidBrainEnabled,
      predictions,
    };
  });
}
