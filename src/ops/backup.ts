import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withSystem } from '../db/pool.js';
import { env } from '../config/env.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'backup' });

export interface BackupFile {
  table: string;
  path: string;
  rows: number;
}

export interface BackupResult {
  dir: string;
  createdAt: string;
  files: BackupFile[];
}

// Tables backed up at least every 24h (REQ 17.4). Encrypted Business_Document blobs
// live in object storage (local dir or S3), which is durable independently; here we
// back up the relational records including document metadata.
const BACKUP_TABLES = ['tender', 'historical_tender_record', 'business_document'] as const;

/**
 * Backs up core data to timestamped gzipped JSON under BACKUP_DIR (REQ 17.4).
 * Runs in the system context to capture all tenants. Production deployments can
 * additionally use pg_dump / managed snapshots; this driver-free export guarantees a
 * recoverable point-in-time copy with no external tooling.
 */
export async function runBackup(baseDir: string = env.BACKUP_DIR): Promise<BackupResult> {
  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, '-');
  const dir = resolve(baseDir, stamp);
  await mkdir(dir, { recursive: true });

  const files: BackupFile[] = [];
  for (const table of BACKUP_TABLES) {
    const rows = await withSystem(async (c) => {
      const res = await c.query(`SELECT * FROM ${table}`);
      return res.rows;
    });
    const path = join(dir, `${table}.json.gz`);
    await writeFile(path, gzipSync(Buffer.from(JSON.stringify(rows))));
    files.push({ table, path, rows: rows.length });
  }

  log.info({ dir, files: files.map((f) => ({ table: f.table, rows: f.rows })) }, 'backup complete');
  return { dir, createdAt, files };
}
