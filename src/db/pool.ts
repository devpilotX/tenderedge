import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';

let pool: Pool | null = null;

/** Returns the process-wide connection pool, creating it on first use. */
export function getPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    host: env.PGHOST,
    port: env.PGPORT,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: env.PGDATABASE,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => logger.error({ err }, 'idle pg client error'));
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Unscoped query — for migrations, auth lookups, and admin paths only. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
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

/**
 * Runs `fn` inside a transaction with the tenant RLS context set.
 *
 * `SET LOCAL app.business_account_id` scopes the value to the transaction, so
 * Row-Level Security policies (which read current_setting('app.business_account_id'))
 * restrict every statement to this tenant — defense-in-depth even if a query
 * forgets an explicit WHERE business_account_id filter (INV1, REQ 1.4, 16.4).
 *
 * `app.bypass_rls` is left off so RLS is always enforced for tenant work.
 */
export async function withTenant<T>(
  businessAccountId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // set_config with is_local=true ties the setting to this transaction.
    await client.query(`SELECT set_config('app.business_account_id', $1, true)`, [
      businessAccountId,
    ]);
    await client.query(`SELECT set_config('app.bypass_rls', 'off', true)`);
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

/**
 * Runs `fn` in a transaction with RLS bypass enabled (platform/system context).
 * Used by background workers (e.g. Tender Radar ingestion) that legitimately
 * operate across tenants. Never exposed to user-facing request paths.
 */
export async function withSystem<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.bypass_rls', 'on', true)`);
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
