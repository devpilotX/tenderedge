# TenderEdge — Industrial Tender & Contract Platform

A multi-tenant B2B SaaS platform that helps small and mid-size factories and suppliers
discover, evaluate, and win government and private tenders. TenderEdge continuously
aggregates public tender listings, ranks them per business (Smart Match), predicts winning
price ranges (Bid Brain), tracks deadlines, organizes bidding documents, and presents
everything on a live white-and-teal dashboard.

> Source of truth: the specification in `.kiro/steering/` (`requirements.md`, `design.md`,
> `tasks.md`). This codebase implements that spec end to end.

## Tech stack

| Concern | Choice |
|---|---|
| Backend | Node.js + TypeScript (ESM) |
| Datastore | PostgreSQL (partitioning + Row-Level Security for tenant isolation) |
| Background work | Job queue abstraction — BullMQ/Redis (prod) or in-memory (dev/test) |
| Live updates | WebSockets |
| Document storage | Encrypted object storage — AES-256-GCM local driver (dev) or S3 (prod) |
| Auth | Session tokens + argon2id password hashing, 30-min inactivity expiry |
| Tests | Vitest + fast-check (property-based) |

### Driver abstractions

The job queue and object storage are defined behind interfaces with two interchangeable
drivers each. Production uses Redis (BullMQ) and S3; development/test use an in-process
queue and an encrypted local-filesystem store. This lets the full platform run and the
entire test suite pass with **no Redis or Docker dependency**, while the production drivers
are real, first-class implementations selected via environment variables.

## Prerequisites

- Node.js >= 20 (developed on Node 24)
- PostgreSQL >= 14 (developed on PostgreSQL 18)
- Redis is **optional** locally (set `QUEUE_DRIVER=memory`, the default)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#   Edit .env: set PGUSER/PGPASSWORD, and generate a document encryption key:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Create databases (app + test)
npm run db:setup

# 4. Run migrations
npm run migrate

# 5. (optional) Seed source portals and demo data
npm run seed
```

## Running

```bash
npm run dev      # start API with hot reload
npm run build    # compile TypeScript to dist/
npm start        # run the compiled server
```

Health check: `GET http://localhost:4000/health`

## Testing

```bash
npm test                 # full suite
npm run test:unit        # deterministic unit tests
npm run test:property    # property-based tests (fast-check)
npm run test:integration # external-boundary integration tests
```

The test suite uses a dedicated database (`PGDATABASE_TEST`) and the in-memory queue driver.

## Project layout

```
src/
  config/     env + platform (tiers, vocabularies) + portals config loaders
  core/       logger, typed errors, health
  db/         pg pool (tenant-scoped RLS helpers), migration runner, migrations/
  queue/      job queue abstraction + redis (BullMQ) and memory drivers
  http/       Express app factory
test/
  unit/ property/ integration/   test suites
```

## License

Proprietary — all rights reserved.
