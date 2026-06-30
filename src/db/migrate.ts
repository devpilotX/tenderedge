import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { PoolClient } from 'pg';
import { getAdminPool, closePool, withAdminTransaction } from './pool.js';
import { logger } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');
const DOWN_MARKER = /^--\s*DOWN\s*$/im;

interface Migration {
  id: string;
  up: string;
  down: string;
}

function loadMigrations(): Migration[] {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const parts = raw.split(DOWN_MARKER);
    const up = (parts[0] ?? '').replace(/^--\s*UP\s*$/im, '').trim();
    const down = (parts[1] ?? '').trim();
    return { id: file.replace(/\.sql$/, ''), up, down };
  });
}

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function appliedIds(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  return new Set(rows.map((r) => r.id));
}

export async function migrateUp(): Promise<string[]> {
  const migrations = loadMigrations();
  const applied: string[] = [];
  await withAdminTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const done = await appliedIds(client);
    for (const m of migrations) {
      if (done.has(m.id)) continue;
      logger.info({ migration: m.id }, 'applying migration');
      await client.query(m.up);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
      applied.push(m.id);
    }
  });
  return applied;
}

export async function migrateDown(steps = 1): Promise<string[]> {
  const migrations = loadMigrations();
  const reverted: string[] = [];
  await withAdminTransaction(async (client) => {
    await ensureMigrationsTable(client);
    const done = await appliedIds(client);
    const toRevert = migrations
      .filter((m) => done.has(m.id))
      .reverse()
      .slice(0, steps);
    for (const m of toRevert) {
      if (!m.down) {
        logger.warn({ migration: m.id }, 'no DOWN section; skipping');
        continue;
      }
      logger.info({ migration: m.id }, 'reverting migration');
      await client.query(m.down);
      await client.query('DELETE FROM schema_migrations WHERE id = $1', [m.id]);
      reverted.push(m.id);
    }
  });
  return reverted;
}

export async function migrationStatus(): Promise<{ id: string; applied: boolean }[]> {
  const migrations = loadMigrations();
  await withAdminTransaction((client) => ensureMigrationsTable(client));
  const done = await getAdminPool()
    .query<{ id: string }>('SELECT id FROM schema_migrations')
    .then((r) => new Set(r.rows.map((x) => x.id)));
  return migrations.map((m) => ({ id: m.id, applied: done.has(m.id) }));
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'up';
  try {
    if (cmd === 'up') {
      const applied = await migrateUp();
      logger.info({ count: applied.length, applied }, 'migrations up complete');
    } else if (cmd === 'down') {
      const steps = Number(process.argv[3] ?? '1');
      const reverted = await migrateDown(steps);
      logger.info({ reverted }, 'migrations down complete');
    } else if (cmd === 'status') {
      const status = await migrationStatus();
      for (const s of status) {
        logger.info(`${s.applied ? '[x]' : '[ ]'} ${s.id}`);
      }
    } else {
      logger.error(`unknown command: ${cmd}`);
      process.exitCode = 1;
    }
  } finally {
    await closePool();
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exit(1);
  });
}
