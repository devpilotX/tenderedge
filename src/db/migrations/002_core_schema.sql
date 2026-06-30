-- UP
-- ────────────────────── Core schema (REQ 1, 6, 15, 16) ──────────────────────
-- Tenant-owned tables carry business_account_id and are protected by Row-Level
-- Security. Tender / HistoricalTenderRecord / SourcePortal hold public, platform-
-- global data and are not tenant-scoped. Tender and HistoricalTenderRecord are
-- partitioned and indexed for the 10M-record / 2s-p95 scale targets (REQ 15).

-- ── Tenant root ─────────────────────────────────────────────────────────────────
CREATE TABLE business_account (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  owner_user_id      uuid,
  subscription_tier  text NOT NULL DEFAULT 'basic'
                       CHECK (subscription_tier IN ('basic','premium','enterprise')),
  status             text NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','read_only','suspended')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_user (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  email               text NOT NULL,
  password_hash       text NOT NULL,
  role                text NOT NULL CHECK (role IN ('owner','manager','viewer')),
  last_active_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Platform-wide unique email (case-insensitive) → duplicate-email rejection (REQ 1.2, ERR1).
CREATE UNIQUE INDEX business_user_email_unique ON business_user (lower(email));
CREATE INDEX business_user_account_idx ON business_user (business_account_id);

-- ── Public tender data (global, partitioned) ─────────────────────────────────
-- Partitioned by HASH(source_portal): keeps the dedup PRIMARY KEY
-- (source_portal, source_identifier) valid (a partitioned table's unique key must
-- include the partition key) while distributing rows for scale. INV2 dedup is the PK.
CREATE TABLE tender (
  source_portal          text NOT NULL,
  source_identifier      text NOT NULL,
  title                  text NOT NULL,
  product_category       text,
  region                 text,
  estimated_value        numeric(18,2),
  estimated_value_status text NOT NULL DEFAULT 'known'
                           CHECK (estimated_value_status IN ('known','unknown')),
  deadline               timestamptz,
  deadline_status        text NOT NULL DEFAULT 'known'
                           CHECK (deadline_status IN ('known','unknown')),
  status                 text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  retrieved_at           timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_portal, source_identifier)
) PARTITION BY HASH (source_portal);

CREATE TABLE tender_p0 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 0);
CREATE TABLE tender_p1 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 1);
CREATE TABLE tender_p2 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 2);
CREATE TABLE tender_p3 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 3);
CREATE TABLE tender_p4 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 4);
CREATE TABLE tender_p5 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 5);
CREATE TABLE tender_p6 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 6);
CREATE TABLE tender_p7 PARTITION OF tender FOR VALUES WITH (MODULUS 8, REMAINDER 7);

-- Smart Match / dashboard query path (REQ 15.2).
CREATE INDEX tender_cat_region_deadline_idx ON tender (product_category, region, deadline);
CREATE INDEX tender_status_deadline_idx ON tender (status, deadline);

-- ── Per-account match configuration & results ──────────────────────────────
CREATE TABLE match_filter (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL UNIQUE REFERENCES business_account(id) ON DELETE CASCADE,
  regions             text[] NOT NULL DEFAULT '{}',
  product_categories  text[] NOT NULL DEFAULT '{}',
  min_value           numeric(18,2),
  max_value           numeric(18,2),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tender_match (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id       uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  tender_source_portal      text NOT NULL,
  tender_source_identifier  text NOT NULL,
  match_score               int NOT NULL CHECK (match_score BETWEEN 0 AND 100), -- INV4
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, tender_source_portal, tender_source_identifier),
  FOREIGN KEY (tender_source_portal, tender_source_identifier)
    REFERENCES tender(source_portal, source_identifier) ON DELETE CASCADE
);
CREATE INDEX tender_match_account_score_idx
  ON tender_match (business_account_id, match_score DESC);

CREATE TABLE pursued_tender (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id       uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  tender_source_portal      text NOT NULL,
  tender_source_identifier  text NOT NULL,
  stage                     text NOT NULL DEFAULT 'watching'
                              CHECK (stage IN ('watching','preparing','submitted','won','lost','closed')),
  tracked_deadline          timestamptz,
  reminder_offsets_days     int[],            -- custom reminder intervals (REQ 8.4); NULL = defaults
  closed_at                 timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_account_id, tender_source_portal, tender_source_identifier),
  FOREIGN KEY (tender_source_portal, tender_source_identifier)
    REFERENCES tender(source_portal, source_identifier) ON DELETE CASCADE
);
CREATE INDEX pursued_tender_deadline_idx ON pursued_tender (tracked_deadline);

-- ── Historical outcomes (global, partitioned by close month/year) ────────────────
CREATE TABLE historical_tender_record (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  product_category     text,
  region               text,
  source_portal        text,
  source_identifier    text,
  attributes_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  awarded_price        numeric(18,2),
  awarded_price_status text NOT NULL DEFAULT 'known'
                         CHECK (awarded_price_status IN ('known','unknown')),
  closed_at            timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, closed_at)
) PARTITION BY RANGE (closed_at);

CREATE TABLE historical_tender_record_2024 PARTITION OF historical_tender_record
  FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');
CREATE TABLE historical_tender_record_2025 PARTITION OF historical_tender_record
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE historical_tender_record_2026 PARTITION OF historical_tender_record
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE historical_tender_record_2027 PARTITION OF historical_tender_record
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');
CREATE TABLE historical_tender_record_default PARTITION OF historical_tender_record DEFAULT;

CREATE INDEX historical_cat_region_idx
  ON historical_tender_record (product_category, region);

-- ── Predictions (per account) ─────────────────────────────────────────
CREATE TABLE price_prediction (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id       uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  tender_source_portal      text NOT NULL,
  tender_source_identifier  text NOT NULL,
  lower_bound               numeric(18,2) NOT NULL,
  upper_bound               numeric(18,2) NOT NULL,
  confidence                numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1), -- INV3
  sample_size               int NOT NULL DEFAULT 0,
  computed_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (lower_bound <= upper_bound),                                                 -- INV3
  UNIQUE (business_account_id, tender_source_portal, tender_source_identifier),
  FOREIGN KEY (tender_source_portal, tender_source_identifier)
    REFERENCES tender(source_portal, source_identifier) ON DELETE CASCADE
);

-- ── Documents (per account, encrypted at rest by the storage layer) ──────────────
CREATE TABLE business_document (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  storage_key         text NOT NULL,
  file_name           text NOT NULL,
  doc_type            text,
  expiry_date         date,
  size_bytes          bigint NOT NULL,
  content_sha256      text,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX business_document_account_idx
  ON business_document (business_account_id) WHERE deleted_at IS NULL;
CREATE INDEX business_document_expiry_idx
  ON business_document (expiry_date) WHERE deleted_at IS NULL;

-- ── Subscriptions / billing ───────────────────────────────────────────
CREATE TABLE subscription (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id   uuid NOT NULL UNIQUE REFERENCES business_account(id) ON DELETE CASCADE,
  tier                  text NOT NULL CHECK (tier IN ('basic','premium','enterprise')),
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','past_due','read_only','canceled')),
  pending_tier          text CHECK (pending_tier IN ('basic','premium','enterprise')),
  current_period_start  timestamptz NOT NULL DEFAULT now(),
  current_period_end    timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  retry_count           int NOT NULL DEFAULT 0,
  last_charge_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ── Notifications ───────────────────────────────────────────────
CREATE TABLE notification_pref (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('email','sms','in_app')),
  enabled             boolean NOT NULL DEFAULT true,
  UNIQUE (business_account_id, channel)
);

CREATE TABLE notification_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('email','sms','in_app')),
  type                text NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','delivered','failed')),
  retry_count         int NOT NULL DEFAULT 0,
  dedupe_key          text,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz
);
-- Idempotent delivery: a delivered notification is never re-sent (ID3).
CREATE UNIQUE INDEX notification_log_dedupe_unique
  ON notification_log (business_account_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX notification_log_account_idx ON notification_log (business_account_id, created_at DESC);

-- ── Source portals (global config/state) ─────────────────────────────────
CREATE TABLE source_portal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL UNIQUE,
  base_url        text NOT NULL,
  rate_limit_rpm  int NOT NULL,
  public_flag     boolean NOT NULL DEFAULT true,
  access_policy   text,
  poll_interval_minutes int NOT NULL DEFAULT 15,
  last_polled_at  timestamptz,
  last_status     text,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Late FK: account owner → user (after both tables exist).
ALTER TABLE business_account
  ADD CONSTRAINT business_account_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES business_user(id) ON DELETE SET NULL;

-- ──────────────────────── Row-Level Security ──────────────────────────
-- Enable RLS + a tenant-isolation policy on every tenant-owned table. The policy
-- keys on app_current_tenant() (the transaction-local GUC set by withTenant). A
-- query with no tenant context (NULL) matches no rows; the privileged pool used by
-- withSystem() bypasses RLS for legitimate cross-tenant work.
ALTER TABLE business_account ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON business_account
  USING (id = app_current_tenant())
  WITH CHECK (id = app_current_tenant());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_user','match_filter','tender_match','pursued_tender',
    'price_prediction','business_document','subscription',
    'notification_pref','notification_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I '
      || 'USING (business_account_id = app_current_tenant()) '
      || 'WITH CHECK (business_account_id = app_current_tenant())', t);
  END LOOP;
END
$$;

-- ──────────────────────── Grants to the app role ──────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tenderedge_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tenderedge_app;

-- DOWN
DROP TABLE IF EXISTS notification_log, notification_pref, subscription, business_document,
  price_prediction, historical_tender_record, pursued_tender, tender_match, match_filter,
  tender, source_portal CASCADE;
ALTER TABLE IF EXISTS business_account DROP CONSTRAINT IF EXISTS business_account_owner_fk;
DROP TABLE IF EXISTS business_user, business_account CASCADE;
