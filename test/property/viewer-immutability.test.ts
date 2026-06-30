import fc from 'fast-check';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { withSystem, withTenant, getAdminPool } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import { createUser } from '../../src/db/repositories/users.js';
import { hashPassword } from '../../src/auth/password.js';
import { runWrite } from '../../src/auth/rbac.js';
import { insertDocument } from '../../src/db/repositories/documents.js';
import { ForbiddenError } from '../../src/core/errors.js';
import type { UserRole } from '../../src/db/entities.js';

/**
 * INV5: any sequence of actions by a viewer-role user produces no state change.
 * Every write goes through runWrite(role, op), which enforces the read-only rule
 * before the operation runs. (REQ 2.5)
 */

let passwordHash = '';

const writeOps: { name: string; run: (role: UserRole, accountId: string, n: number) => Promise<unknown> }[] = [
  {
    name: 'upload-document',
    run: (role, accountId, n) =>
      runWrite(role, () =>
        withTenant(accountId, (c) =>
          insertDocument(c, {
            businessAccountId: accountId,
            storageKey: `k-${n}`,
            fileName: `f-${n}.pdf`,
            docType: 'license',
            expiryDate: null,
            sizeBytes: 10,
            contentSha256: null,
          }),
        ),
      ),
  },
  {
    name: 'rename-account',
    run: (role, accountId, n) =>
      runWrite(role, () =>
        withTenant(accountId, (c) =>
          c.query(`UPDATE business_account SET name = $2 WHERE id = $1`, [accountId, `renamed-${n}`]),
        ),
      ),
  },
  {
    name: 'set-notification-pref',
    run: (role, accountId) =>
      runWrite(role, () =>
        withTenant(accountId, (c) =>
          c.query(
            `INSERT INTO notification_pref (business_account_id, channel, enabled)
             VALUES ($1,'email',false)
             ON CONFLICT (business_account_id, channel) DO UPDATE SET enabled = EXCLUDED.enabled`,
            [accountId],
          ),
        ),
      ),
  },
];

async function snapshot(accountId: string): Promise<{ name: string; docs: number; prefs: number }> {
  const pool = getAdminPool();
  const name = (await pool.query<{ name: string }>(`SELECT name FROM business_account WHERE id=$1`, [accountId])).rows[0]!.name;
  const docs = Number(
    (await pool.query<{ c: string }>(`SELECT count(*) c FROM business_document WHERE business_account_id=$1`, [accountId])).rows[0]!.c,
  );
  const prefs = Number(
    (await pool.query<{ c: string }>(`SELECT count(*) c FROM notification_pref WHERE business_account_id=$1`, [accountId])).rows[0]!.c,
  );
  return { name, docs, prefs };
}

beforeAll(async () => {
  passwordHash = await hashPassword('password12');
});

beforeEach(async () => {
  await resetData();
});

describe('INV5 — viewer immutability', () => {
  it('no sequence of gated writes by a viewer changes any state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.nat({ max: writeOps.length - 1 }), { minLength: 1, maxLength: 8 }),
        async (sequence) => {
          await resetData();
          const accountId = await withSystem(async (c) => {
            const acct = await createBusinessAccount(c, { name: 'baseline' });
            await createUser(c, {
              businessAccountId: acct.id,
              email: `viewer-${acct.id}@x.example`,
              passwordHash,
              role: 'viewer',
            });
            return acct.id;
          });

          const before = await snapshot(accountId);
          let n = 0;
          for (const idx of sequence) {
            const op = writeOps[idx]!;
            let threw = false;
            try {
              await op.run('viewer', accountId, n++);
            } catch (err) {
              threw = err instanceof ForbiddenError;
            }
            if (!threw) return false;
          }
          const after = await snapshot(accountId);
          return after.name === before.name && after.docs === before.docs && after.prefs === before.prefs;
        },
      ),
      { numRuns: 10 },
    );
  });

  it('positive control: the same operations DO mutate for a manager', async () => {
    const accountId = await withSystem(async (c) => {
      const acct = await createBusinessAccount(c, { name: 'baseline' });
      return acct.id;
    });
    const before = await snapshot(accountId);
    await writeOps[0]!.run('manager', accountId, 1);
    const after = await snapshot(accountId);
    expect(after.docs).toBe(before.docs + 1);
  });
});
