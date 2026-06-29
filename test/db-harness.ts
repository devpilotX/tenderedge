import { Client } from 'pg';
import { env } from '../src/config/env.js';
import { getPool, query } from '../src/db/pool.js';
import { migrateUp } from '../src/db/migrate.js';

let schemaReady = false;

async function ensureDatabaseExists(name: string): Promise<void> {
  const client = new Client({
    host: env.PGHOST,
    port: env.PGPORT,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    database: 'postgres',
  });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
    }
  } finally {
    await client.end();
  }
}

/** Ensures the test database exists and all migrations are applied (idempotent). */
export async function ensureTestSchema(): Promise<void> {
  if (schemaReady) return;
  await ensureDatabaseExists(env.PGDATABASE);
  await migrateUp();
  schemaReady = true;
}

/**
 * Truncates all tenant/data tables for test isolation. Keeps schema and
 * reference data (source_portals are reseeded by tests that need them).
 */
export async function resetData(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{ tablename: string }>(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  `);
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
