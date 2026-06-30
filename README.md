# TenderEdge — Industrial Tender & Contract Platform

A multi-tenant B2B SaaS platform that helps small and mid-size factories and suppliers
discover, evaluate, and win government and private tenders. TenderEdge continuously
aggregates public tender listings, ranks them per business (**Smart Match**), predicts
winning price ranges (**Bid Brain**), tracks deadlines, organizes bidding documents, and
presents everything on a live white-and-teal dashboard.

> Source of truth: the specification in `.kiro/steering/` (`requirements.md`, `design.md`,
> `tasks.md`, `ui.html`). This codebase implements that spec end to end. All 13 task groups
> are complete; the full automated suite is green.

## Features (subsystems)

| Subsystem | What it does |
|---|---|
| **Auth & Tenant** | Registration (dup-email rejected), argon2id passwords, server-side sessions with 30-min inactivity expiry, RBAC (owner/manager/viewer; viewer read-only) |
| **Tender Radar** | Scheduled per-portal polling, robots-policy + rate-limit-respecting scraper, normalize → dedupe → upsert aggregation, per-portal failure isolation |
| **Smart Match** | Per-account region/category/value filters, deterministic Match_Score (0–100), tier-limited regions, ranked listings, expiry removal |
| **Historical + Bid Brain** | 5-year historical outcomes; entitlement-gated price-range prediction with insufficient-data handling |
| **Deadline Guard** | Pursued-tender tracking, default (7/1-day) + custom reminders, grace-period closure |
| **Document Helper** | AES-256-GCM encrypted storage, 50 MB limit, authorized retrieval, cross-tenant denial, expiry reminders |
| **Notifications** | Email/SMS/in-app channels with per-channel preferences, bounded retry with final-outcome logging, no resend |
| **Subscription & Billing** | Basic/Premium/Enterprise tiers, monthly charge with retry → read-only restriction, tier change at next cycle, downgrade region selection |
| **Dashboard + Realtime** | Aggregated summary API + live WebSocket push (matches/status) with reconnect-resync; white/teal SPA |
| **Reliability** | 24h automated backups, graceful per-job degradation, load/perf validation |

## Tech stack

| Concern | Choice |
|---|---|
| Backend | Node.js + TypeScript (ESM, strict) |
| Datastore | PostgreSQL — partitioning + Row-Level Security for tenant isolation |
| Background work | Job-queue abstraction — BullMQ/Redis (prod) or in-memory (dev/test) |
| Live updates | WebSockets (`ws`) |
| Document storage | Encrypted object storage — AES-256-GCM local driver (dev) or S3 (prod) |
| Auth | Session tokens + argon2id hashing, 30-min inactivity expiry |
| Tests | Vitest + fast-check (property-based) |

### Driver abstractions

The job queue, object storage, and notification/billing providers are defined behind
interfaces with interchangeable drivers. Production uses Redis (BullMQ), S3, SMTP/SES/Twilio,
and Stripe; development/test use an in-process queue, an encrypted local-filesystem store,
and console/mock providers. This lets the whole platform run and the **entire test suite pass
with no Redis, Docker, or cloud dependency**, while the production drivers are real,
first-class implementations selected via environment variables.

## Prerequisites

- Node.js >= 20 (developed on Node 24)
- PostgreSQL >= 14 (developed on PostgreSQL 18)
- Redis is **optional** locally (set `QUEUE_DRIVER=memory`, the default)

## Setup

```bash
npm install                       # 1. install deps (generates package-lock.json)
cp .env.example .env              # 2. configure; set PGUSER/PGPASSWORD and a doc key:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
npm run db:setup                  # 3. create app + test databases
npm run migrate                   # 4. run migrations (creates the RLS app role + schema)
npm run seed                      # 5. (optional) seed source portals
```

## Running

```bash
npm run dev      # API with hot reload
npm run build    # compile to dist/
npm start        # run compiled server (dist/server.js)
```

Open `http://localhost:4000/` for the dashboard; health at `GET /health`.
(If port 4000 is busy, set `PORT`.)

## Testing

```bash
npm test                 # full suite (unit + property + integration)
npm run test:unit        # deterministic + service unit tests
npm run test:property    # property-based tests (fast-check)
npm run test:integration # external-boundary integration tests
npm run test:load        # standalone scale/latency load test (set LOAD_TENDERS)
```

The suite uses a dedicated database (`PGDATABASE_TEST`) and the in-memory queue driver.

## API overview

```
POST /auth/register · POST /auth/login · GET /auth/session · POST /auth/logout
PUT  /match/filters · GET /match/filters · GET /match/matches
GET  /bidbrain/predict
POST /deadline/pursue · DELETE /deadline/pursue · GET /deadline/pursued · PATCH /deadline/stage · PUT /deadline/reminders
POST /documents · GET /documents · GET /documents/:id · DELETE /documents/:id
GET  /notifications · GET/PUT /notifications/prefs
GET  /billing · POST /billing/subscribe · POST /billing/change-tier · POST /billing/select-regions · POST /billing/pay
GET  /dashboard/summary
WS   /ws?token=<session>        # live match / tender-status events
```

## Background jobs (scheduled)

`radar.poll` (per portal) · `match.maintenance` · `deadline.scan` · `notification.dispatch`
· `billing.cycle` · `backup.run`. Each is wrapped so a failure is isolated and logged
(graceful degradation).

## Correctness properties (property-based tests)

- **INV1** tenant isolation (RLS) · **INV2** tender dedup · **INV3** prediction bounds ·
  **INV4** score in [0,100] · **INV5** viewer immutability
- **RT1** scraper parse/serialize round-trip · **RT2** document byte-identical round-trip
- **ID1** upsert idempotence · **ID2** match re-evaluation idempotence · **ID3** no notification resend
- **MM1** tier-region monotonicity · **MM2** prediction sufficiency monotonicity

## Project layout

```
src/
  config/        env (zod) + platform tiers/vocabularies + source-portal loader
  core/          logger, typed errors, health
  db/            pg pools (RLS app role + admin), migrations, repositories, entities
  queue/         job-queue abstraction + redis (BullMQ) and memory drivers
  auth/          argon2id passwords, RBAC, register/login/session service
  radar/         scheduler, robots policy, rate limiter, HTTP adapter, normalization, aggregation
  match/         deterministic scoring + evaluation service
  bidbrain/      historical outcomes + price prediction
  deadline/      reminder computation + grace closure service
  documents/     encrypted upload/retrieve/delete + expiry scan
  notifications/ providers, delivery loop, preferences
  billing/       provider abstraction (mock/stripe) + subscription service
  dashboard/     aggregation service
  realtime/      WebSocket hub
  storage/       AES-256-GCM crypto + local/S3 drivers
  ops/           backups + safe-job wrapper
  http/          Express app, middleware, routers
test/  unit/ · property/ · integration/ · load/
public/index.html   white/teal dashboard SPA
```

## License

Proprietary — all rights reserved.
