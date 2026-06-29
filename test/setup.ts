import { beforeAll, afterAll } from 'vitest';

/**
 * Global test setup.
 *
 * Forces the suite onto the dedicated test database and the in-memory queue
 * driver so the full suite runs with no Redis dependency. Must run before any
 * module reads config, so we set env vars at import time.
 */
process.env.NODE_ENV = 'test';
process.env.QUEUE_DRIVER = process.env.QUEUE_DRIVER ?? 'memory';
process.env.STORAGE_DRIVER = process.env.STORAGE_DRIVER ?? 'local';
process.env.STORAGE_LOCAL_DIR = process.env.STORAGE_LOCAL_DIR ?? './storage/test';
// Deterministic 32-byte key (base64) for document encryption tests.
process.env.DOCUMENT_ENCRYPTION_KEY =
  process.env.DOCUMENT_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64');
// Route the app database name to the test database.
if (process.env.PGDATABASE_TEST) {
  process.env.PGDATABASE = process.env.PGDATABASE_TEST;
} else {
  process.env.PGDATABASE = process.env.PGDATABASE ?? 'tenderedge_test';
  process.env.PGDATABASE_TEST = process.env.PGDATABASE;
}

beforeAll(async () => {
  // Ensure schema is present for DB-backed suites. Import lazily so env is set first.
  const { ensureTestSchema } = await import('./db-harness.js');
  await ensureTestSchema();
});

afterAll(async () => {
  const { closePool } = await import('../src/db/pool.js');
  await closePool();
});
