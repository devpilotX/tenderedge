import { Client } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../core/logger.js';

/**
 * Creates the application and test databases if they do not exist.
 * Connects to the maintenance database `postgres` to issue CREATE DATABASE.
 */
async function ensureDatabase(name: string): Promise<void> {
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
      // Identifier cannot be parameterized; name comes from validated env, not user input.
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
      logger.info({ database: name }, 'created database');
    } else {
      logger.info({ database: name }, 'database already exists');
    }
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  await ensureDatabase(env.PGDATABASE);
  await ensureDatabase(env.PGDATABASE_TEST);
}

main().catch((err) => {
  logger.error({ err }, 'db setup failed');
  process.exit(1);
});
