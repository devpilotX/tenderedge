# Design Document

## Overview

The Industrial Tender and Contract Platform is a multi-tenant B2B SaaS system that aggregates public tender data, matches and ranks it for each business, predicts winning price ranges, tracks deadlines, organizes bidding documents, and presents everything on a live dashboard. Revenue comes from monthly per-business subscriptions with tier-based feature and region entitlements.

This design translates the requirements into a concrete architecture. It follows the stakeholder technology direction: a Node.js backend for high-throughput data pulling, PostgreSQL for storing millions of tender records, websockets for live dashboard updates, a clean white-and-teal web dashboard, and always-on cloud hosting.

The system is decomposed into focused services so a failure in one area (for example, a scraping outage) does not take down the dashboard or notifications. Tenant isolation is enforced at every layer.

## Architecture

### High-Level Architecture

```
                         +-------------------------+
                         |      Web Dashboard      |
                         |  (white/teal classic UI)|
                         +-----------+-------------+
                                     | HTTPS + WSS
                         +-----------v-------------+
                         |       API Gateway       |
                         | auth, routing, tenant   |
                         |  scoping, rate limiting  |
                         +-----------+-------------+
                                     |
   +-----------------+---------------+----------------+------------------+
   |                 |               |                |                  |
+--v---+      +------v-----+   +-----v------+   +-----v-------+   +------v------+
|Auth &|      | Tender API |   | Bid Brain  |   | Document    |   | Billing /   |
|Tenant|      | (match,    |   | (predict)  |   | Helper API  |   | Subscription|
|Svc   |      |  pursue)   |   |            |   |             |   | Svc         |
+--+---+      +------+-----+   +-----+------+   +-----+-------+   +------+------+
   |                 |               |                |                  |
   |          +------v---------------v----------------v------------------v---+
   |          |                  PostgreSQL (primary)                        |
   |          |  tenants, users, tenders, matches, historical, documents,    |
   |          |  subscriptions, notifications, deadlines                     |
   |          +------+-----------------------------+------------------------+
   |                 |                             |
+--v-----------------v---+            +------------v-------------+
| Tender Radar Workers   |            | Realtime Hub (websocket) |
| (scheduler + scrapers  |            | pushes matches/updates   |
|  + aggregation engine) |            +------------+-------------+
+-----------+------------+                         |
            |                          +-----------v-----------+
   +--------v---------+                | Notification Service  |
   |  Source Portals  |                | email / SMS / in-app  |
   |  (public data)   |                +-----------------------+
   +------------------+

   +------------------------------------------------------------+
   | Background Job Queue (deadline scans, predictions,         |
   | billing cycles, document expiry scans, retries)            |
   +------------------------------------------------------------+
```

### Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Backend runtime | Node.js (TypeScript) | High-throughput, async I/O suited to many concurrent scraping and API calls (stakeholder direction) |
| Primary datastore | PostgreSQL | Relational integrity, partitioning, and proven scale to 10M+ records (stakeholder direction) |
| Live updates | WebSockets (WSS) | Push matched tenders and status changes within 5 seconds (stakeholder direction) |
| Background work | Job queue (e.g. BullMQ on Redis) | Scheduled polling, deadline scans, billing retries, prediction jobs |
| Caching / pub-sub | Redis | Fan-out of realtime events across API nodes; hot query caching |
| Object storage | Encrypted blob store (e.g. S3-compatible) | Encrypted-at-rest Business_Document storage |
| Auth | JWT sessions + hashed passwords (bcrypt/argon2) | Stateless API auth with 30-minute inactivity expiry |
| Hosting | Always-on cloud with autoscaling + multi-AZ | 99.5% availability and automatic recovery |

### Multi-Tenancy Strategy

Every tenant-owned row carries a `business_account_id`. A shared-database, shared-schema model is used with strict row-level scoping enforced in a data-access layer. PostgreSQL Row-Level Security (RLS) policies provide defense-in-depth so that even a query missing an explicit filter cannot cross tenants. The API Gateway resolves the authenticated tenant and injects the tenant context into every downstream call.

## Components and Interfaces

### 1. Auth & Tenant Service
- Registers Business_Accounts and owner users; rejects duplicate emails.
- Authenticates users, issues sessions, enforces 30-minute inactivity expiry.
- Stores passwords with a one-way hash (argon2id).
- Enforces roles (owner, manager, viewer) only within authenticated sessions; viewer is read-only.
- Maps requests, REQ 1, REQ 2.

Key interface:
```
POST /auth/register      -> { businessAccountId, ownerUserId }
POST /auth/login         -> { sessionToken, role }
GET  /auth/session       -> validates and refreshes activity
```

### 2. Tender Radar (Scheduler + Scraper Workers + Aggregation Engine)
- Scheduler triggers each Source_Portal poll on a configurable interval (default 15 min).
- Scraper workers fetch only public, policy-permitted resources, applying per-portal rate limits; a zero rate limit is treated as a config error and replaced with a minimum default.
- Aggregation Engine parses, normalizes Region and Product_Category to the platform vocabulary, deduplicates by `(source_portal, source_identifier)`, and upserts. On update with missing incoming fields, existing complete values are preserved. Missing deadlines and missing-or-zero values are stored as unknown.
- Records source and retrieval timestamp; excludes personal contact details; logs every exclusion check.
- Maps requests, REQ 3, REQ 4, REQ 17.3.

```
Worker.poll(sourcePortal) -> normalizedListings[]
AggregationEngine.upsert(listing) -> { created | updated, tenderId }
```

### 3. Smart Match Service
- Stores per-account filters: target Regions, Product_Categories, min/max estimated value.
- On each new/updated Tender, evaluates against accounts whose filters and tier-permitted Regions the tender satisfies, computes Match_Score (0-100) from Region, value, deadline proximity, and category alignment.
- Returns matches ordered by descending Match_Score; removes a tender from all match lists when its deadline passes.
- Maps requests, REQ 5, REQ 14, REQ 15.3.

```
SmartMatch.configureFilters(accountId, filters)
SmartMatch.evaluate(tender) -> affectedMatches[]
SmartMatch.listMatches(accountId, page) -> tenders[] (desc Match_Score)
```

### 4. Historical Data + Bid Brain Service
- When a tender closes and an awarded price is available, stores a Historical_Tender_Record (retained 5+ years) with whatever Product_Category/Region associations are possible. Zero or missing awarded prices are marked unknown pending validation.
- Bid Brain, for accounts entitled to it, automatically computes a Price_Range_Prediction (lower, upper, confidence 0-1) per pursued tender, using historical records matching the tender's Product_Category and Region. Guarantees lower <= upper. Returns "insufficient data" when fewer than 10 matching records exist.
- Maps requests, REQ 6, REQ 7.

```
HistoricalStore.recordOutcome(tender, awardedPrice)
BidBrain.predict(tenderId, accountId) -> { lower, upper, confidence } | InsufficientData | NotEntitled
```

### 5. Deadline Guard Service
- Tracks deadlines for tenders an account chooses to pursue.
- Fires reminders at 7 days and 1 day by default, or at account-configured custom intervals.
- After a deadline passes, waits a configurable grace period before marking the pursued tender closed.
- Maps requests, REQ 8.

### 6. Document Helper Service
- Stores uploaded Business_Documents in encrypted object storage, scoped to the account, with type label and expiry date.
- Returns only documents currently in active storage; rejects files over 50 MB; supports deletion.
- Fires expiry reminder when 30 days or fewer remain.
- Maps requests, REQ 9, REQ 16.

### 7. Dashboard + Realtime Hub
- Aggregates live matched tenders, per-tender win-chance (Match_Score), Money_Pipeline (estimated value of pursued tenders grouped by stage), and recommended next actions ordered by deadline proximity. Shows predictions where Bid Brain is enabled.
- Realtime Hub pushes new matches and status changes to active sessions within 5 seconds over WSS, with reconnect-and-resync on dropped connections.
- Maps requests, REQ 10, REQ 11.

### 8. Notification Service
- Supports email, SMS, and in-app channels; delivers through every channel the account enabled.
- Retries failed delivery up to 3 times, recording the final outcome; increments retry counts only on actual failures; channels can be toggled per user.
- Maps requests, REQ 12.

### 9. Subscription & Billing Service
- Offers Basic (<=5 Regions, no Bid Brain), Premium (<=20 Regions, Bid Brain), Enterprise (>=100 Regions, Bid Brain).
- Grants entitlements on subscribe; charges monthly; retries failed charges up to 3 times over 7 days with notification; restricts to read-only when unpaid beyond retry window.
- Applies tier changes at the next billing cycle; on downgrade exceeding region limit, prompts the account to choose which Regions to keep.
- Maps requests, REQ 13, REQ 14.3.

## Data Models

```
BusinessAccount(id, name, owner_user_id, subscription_tier, created_at)
BusinessUser(id, business_account_id, email UNIQUE, password_hash, role, last_active_at)
Tender(id, source_portal, source_identifier, title, product_category, region,
       estimated_value NULLABLE, deadline NULLABLE, retrieved_at, status,
       UNIQUE(source_portal, source_identifier))
MatchFilter(id, business_account_id, regions[], product_categories[], min_value, max_value)
TenderMatch(id, business_account_id, tender_id, match_score, created_at,
            UNIQUE(business_account_id, tender_id))
PursuedTender(id, business_account_id, tender_id, stage, tracked_deadline, closed_at)
HistoricalTenderRecord(id, product_category NULLABLE, region NULLABLE, attributes_json,
                       awarded_price NULLABLE, awarded_price_status, closed_at)
PricePrediction(id, business_account_id, tender_id, lower, upper, confidence, computed_at)
BusinessDocument(id, business_account_id, storage_key, doc_type, expiry_date, size_bytes,
                 uploaded_at, deleted_at NULLABLE)
Subscription(id, business_account_id, tier, status, current_period_end, retry_count)
NotificationPref(id, business_account_id, channel, enabled)
NotificationLog(id, business_account_id, channel, type, status, retry_count, sent_at)
SourcePortal(id, name, base_url, rate_limit, public_flag, access_policy)
```

Scale notes: `Tender` and `HistoricalTenderRecord` are partitioned (by region or retrieval month) and indexed on `(product_category, region, deadline)` to meet the 10M-record and 2-second p95 query targets. RLS policies key on `business_account_id`.

## Correctness Properties

### Invariants
- INV1: Every tenant-owned record has exactly one `business_account_id`, and a query under tenant A never returns tenant B's rows. (REQ 1, REQ 16)
- INV2: A `Tender` is unique by `(source_portal, source_identifier)`; re-ingesting the same listing never creates a duplicate. (REQ 3.3)
- INV3: For any PricePrediction, `lower <= upper` and `0 <= confidence <= 1`. (REQ 7.3, REQ 7.6)
- INV4: Every Match_Score is within [0, 100]. (REQ 5.3)
- INV5: A viewer-role user never causes a state change. (REQ 2.5)

### Round-Trip Properties
- RT1: Parsing a Source_Portal listing then serializing the normalized Tender then re-parsing yields an equivalent normalized Tender (scraper parse/normalize round-trip). (REQ 3.2, REQ 3.6)
- RT2: A stored then retrieved Business_Document returns byte-identical content. (REQ 9.1, REQ 9.3)

### Idempotence
- ID1: Upserting the same unchanged listing twice leaves the Tender record identical to a single upsert. (REQ 3.3)
- ID2: Re-running Smart_Match evaluation on an unchanged tender produces the same match set and scores. (REQ 5.2, REQ 5.3)
- ID3: Delivering a notification marked delivered is not re-sent. (REQ 12)

### Metamorphic Properties
- MM1: Adding a Region outside an account's tier to a tender never increases that account's match count. (REQ 5.5, REQ 14)
- MM2: More matching Historical_Tender_Records never reduces Bid Brain confidence below the insufficient-data threshold behavior. (REQ 7.4, REQ 7.5)

### Error Conditions
- ERR1: Duplicate-email registration is rejected. (REQ 1.2)
- ERR2: Files over 50 MB are rejected. (REQ 9.6)
- ERR3: Bid Brain requests from non-entitled accounts are denied with an upgrade message. (REQ 7.2)
- ERR4: Cross-tenant document access is denied (silently permitted). (REQ 16.4)
- ERR5: A zero configured rate limit falls back to a minimum default. (REQ 4.3)

## Error Handling

- Scraping failures are isolated per Source_Portal: a failure is logged and retried next interval while other portals continue (REQ 3.4, REQ 17.2).
- Subsystem failures degrade gracefully; the dashboard and notifications keep running if scraping is down (REQ 17.2).
- Billing failures trigger bounded retries with notification, then read-only restriction (REQ 13.4, REQ 13.5).
- Notification delivery failures use bounded retries with outcome logging (REQ 12.3).
- Realtime disconnects trigger reconnect-and-resync (REQ 11.3).

## Testing Strategy

- **Property-based tests** for: scraper parse/normalize round-trip (RT1), upsert idempotence (ID1), Smart_Match score bounds and tier filtering (INV4, MM1), Bid Brain bound ordering and confidence range (INV3), and tenant isolation invariants (INV1).
- **Integration tests** (1-3 examples, not property-based) for: external Source_Portal connectivity, email/SMS provider delivery, object-storage encryption wiring, and billing-provider charge flows. These touch external services where 100 iterations add no value.
- **Unit tests** for deterministic logic: deadline interval computation, grace-period closure, entitlement checks, region-limit enforcement.
- **Load tests** validating 10M-record storage, 2s p95 match query, and 10s match evaluation under load (REQ 15).

## Design Decisions and Rationale

- **Service decomposition over monolith**: required so a scraping outage cannot break the dashboard (REQ 17.2).
- **Shared-schema multi-tenancy with RLS**: scales to many small/mid tenants cost-effectively while keeping strong isolation (REQ 1, REQ 16).
- **Upsert keyed on source identity**: directly enforces the no-duplicate invariant and makes ingestion idempotent (REQ 3.3).
- **Automatic prediction for entitled accounts**: matches the clarified expectation that predictions are produced whenever Bid Brain is enabled (REQ 7.1).
- **Partitioned + indexed tender tables**: needed to meet the millions-of-records scale and latency targets (REQ 15).
- **Public-data-only sourcing with per-portal policy checks and rate limits**: keeps aggregation within legal, ethical bounds (REQ 4).
