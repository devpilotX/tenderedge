# BLOCKERS

No hard blockers were hit — every task group in `.kiro/steering/tasks.md` was implemented,
tested, and merged. This file records environment notes and engineering decisions made to
keep the build fully runnable and the test suite green in the local environment.

## Environment notes

- **No Redis / no Docker locally.** The job queue and pub/sub are defined behind a driver
  interface. The **Redis (BullMQ) driver is real, first-class code** used in production
  (`QUEUE_DRIVER=redis`); the in-memory driver is the dev/test default so the full suite
  runs with no Redis. Same pattern for object storage (real **S3 driver** vs. encrypted
  local-filesystem driver) and notifications/billing providers.
- **PostgreSQL 18** is used for real (migrations, RLS, partitioning, all DB-backed tests).
  Row-Level Security is genuinely enforced: the app connects as a non-superuser role
  (`tenderedge_app`) because superusers bypass RLS.
- **Port 4000 was occupied** by another local service during the boot smoke test, so the
  smoke check used `PORT=4055`. The default remains 4000.

## Production drivers present but not exercised locally

These are real implementations selected via environment variables; they require their
external service + credentials and so are not run by the local suite:

- `QUEUE_DRIVER=redis` (BullMQ/ioredis) — requires Redis.
- `STORAGE_DRIVER=s3` (`@aws-sdk/client-s3`, dynamically imported) — requires the package +
  AWS credentials + bucket. The local AES-256-GCM driver provides the same encrypt-at-rest
  guarantee for dev/test.
- `BILLING_DRIVER=stripe` (`stripe`, dynamically imported) — requires the package + key.
- `EMAIL_DRIVER` / `SMS_DRIVER` real transports (SMTP/SES/Twilio) — console drivers are the
  dev default and exercise the full delivery/retry pipeline.

Install the optional packages (`@aws-sdk/client-s3`, `stripe`) and set the matching env vars
to enable the production drivers.

## Decisions worth noting

- **Tender partitioning** is by `HASH(source_portal)` rather than region/month, because a
  partitioned table's keys must include the partition column and the dedup identity
  `(source_portal, source_identifier)` (INV2) must remain a valid primary key. This keeps
  dedup correct while distributing rows for scale.
- **Sessions are server-side** (a `user_session` table) rather than stateless JWTs, to make
  the 30-minute inactivity expiry and revocation exact and auditable.
- The committed `package.json` uses pinned caret ranges; run `npm install` to generate the
  lockfile.

## Security follow-up (not a blocker)

- The repository's `.kiro/settings/mcp.json` contains a GitHub personal access token in
  plaintext. That file is **not** committed (only `.kiro/steering/` specs are). Rotate that
  token, since it was stored unencrypted on disk.
