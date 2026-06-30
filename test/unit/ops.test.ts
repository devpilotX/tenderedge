import { describe, it, expect, beforeEach } from 'vitest';
import { rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { upsertTender } from '../../src/db/repositories/tenders.js';
import { insertHistoricalRecord } from '../../src/db/repositories/historical.js';
import { normalizeListing, toStored } from '../../src/radar/normalize.js';
import { runBackup } from '../../src/ops/backup.js';
import { safeJob } from '../../src/ops/safe-job.js';

describe('Automated backups (REQ 17.4)', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('writes gzipped exports of tenders, historical records, and document metadata', async () => {
    await withSystem(async (c) => {
      await upsertTender(c, toStored(normalizeListing('PortalA', { sourceIdentifier: 'B-1', title: 'T', category: 'couplings', region: 'Patna', estimatedValue: 100000, deadline: '2027-01-01T00:00:00.000Z' }, '2026-06-30T00:00:00.000Z')));
      await insertHistoricalRecord(c, { productCategory: 'Mechanical Couplings', region: 'Patna', sourcePortal: 'PortalA', sourceIdentifier: 'B-1', awardedPrice: 95000, closedAt: '2026-01-01T00:00:00.000Z' });
    });

    const dir = join('./backups', `test-${randomUUID()}`);
    try {
      const result = await runBackup(dir);
      const tables = Object.fromEntries(result.files.map((f) => [f.table, f.rows]));
      expect(tables.tender).toBe(1);
      expect(tables.historical_tender_record).toBe(1);
      expect('business_document' in tables).toBe(true);
      const written = await readdir(result.dir);
      expect(written).toContain('tender.json.gz');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('Graceful degradation — safeJob (REQ 17.2)', () => {
  it('swallows and isolates a failing job (never throws)', async () => {
    let ran = false;
    const job = safeJob('boom', async () => {
      ran = true;
      throw new Error('subsystem failure');
    });
    await expect(job()).resolves.toBeUndefined();
    expect(ran).toBe(true);
  });

  it('runs a healthy job normally', async () => {
    let count = 0;
    await safeJob('ok', async () => {
      count += 1;
    })();
    expect(count).toBe(1);
  });
});
