import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';

/**
 * Two connection identities enforce multi-tenant isolation at the database layer:
 *
 *  - appPool   connects as a NON-superuser role (PGAPPUSER, e.g. tenderedge_app).
 *              Row-Level Security policies apply to it, so a query under tenant A
 *              physically cannot read tenant B's rows (INV1). Used by withTenant()
 *              and the unscoped query() helper.
 *
 *  - adminPool connects as the owning/superuser role (PGUSER, e.g. postgres),
 *              which bypasses RLS. Used for migrations (DDL) and for legitimate
 *              cross-tenant system work (Tender Radar ingestion, Smart Match
 *              evaluation, billing scans) via withSystem().
 *
 * In production, PGUSER may be a dedicated NOSUPERUSER role carrying the BYPASSRLS
 * attribute instead of a full superuser; the split above is what matters.
 */
let appPool: Pool | null = null;
let adminPool: Pool | null = null;

function makePool(user: string, password: string): Pool {
  const pool = new Pool({
    host: env.PGHOST,
    port: env.PGPORT,
    user,
    password,
    database: env.PGDATABASE,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => logger.error({ err, user }, 'idle pg client error'));
  return pool;
}

/** RLS-enforced application pool (non-superuser). */
export function getPool(): Pool {
  if (!appPool) appPool = makePool(env.PGAPPUSER, env.PGAPPPASSWORD);
  return appPool;
}

/** Privileged pool for migrations and cross-tenant system work. */
export function getAdminPool(): Pool {
  if (!adminPool) adminPool = makePool(env.PGUSER, env.PGPASSWORD);
  return adminPool;
}

export async function closePool(): Promise<void> {
  await Promise.all([appPool?.end(), adminPool?.end()]);
  appPool = null;
  adminPool = null;
}

/** Unscoped query on the app pool — subject to RLS. For health and simple reads. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

async function runInTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
  before?: (client: PoolClient) => Promise<void>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (before) await before(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Transaction on the app pool (RLS applies; no tenant context set). */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction(getPool(), fn);
}

/**
 * Runs `fn` inside a transaction with the tenant RLS context set on the app pool.
 *
 * `set_config('app.business_account_id', id, true)` scopes the value to the
 * transaction, so RLS policies (which read it via app_current_tenant()) restrict
 * every statement to this tenant — defense-in-depth even if a query forgets an
 * explicit WHERE business_account_id filter (INV1, REQ 1.4, 16.4).
 */
export async function withTenant<T>(
  businessAccountId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runInTransaction(getPool(), fn, async (client) => {
    await client.query(`SELECT set_config('app.business_account_id', $1, true)`, [
      businessAccountId,
    ]);
  });
}

/**
 * Runs `fn` on the privileged pool for legitimate cross-tenant system work.
 * RLS is bypassed here, so this must never be reachable from user request paths
 * with attacker-controlled scope.
 */
export async function withSystem<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return runInTransaction(getAdminPool(), fn);
}

/** Transaction on the privileged pool — used by the migration runner for DDL. */
export async function withAdminTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return runInTransaction(getAdminPool(), fn);
}
