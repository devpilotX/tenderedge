import fc from 'fast-check';
import { describe, it } from 'vitest';
import { withSystem, withTenant } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount, findAccountById } from '../../src/db/repositories/accounts.js';
import { insertDocument, listActiveDocuments } from '../../src/db/repositories/documents.js';

/**
 * INV1: every tenant-owned record has exactly one business_account_id, and a query
 * under tenant A never returns tenant B's rows — even when A explicitly filters by
 * B's id. Enforced by PostgreSQL Row-Level Security, exercised here through the
 * non-superuser app pool used by withTenant(). (REQ 1.3, 1.4, 16.4)
 */
describe('INV1 — multi-tenant isolation (RLS)', () => {
  it('a tenant only ever sees its own rows, regardless of explicit filters', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ name: fc.string({ maxLength: 12 }), docs: fc.nat({ max: 4 }) }), {
          minLength: 2,
          maxLength: 4,
        }),
        async (specs) => {
          await resetData();

          const accounts = await withSystem(async (client) => {
            const created: { id: string; docs: number }[] = [];
            for (const s of specs) {
              const acct = await createBusinessAccount(client, { name: s.name || 'acct' });
              for (let i = 0; i < s.docs; i++) {
                await insertDocument(client, {
                  businessAccountId: acct.id,
                  storageKey: `key-${acct.id}-${i}`,
                  fileName: `file-${i}.pdf`,
                  docType: 'license',
                  expiryDate: null,
                  sizeBytes: 100 + i,
                  contentSha256: null,
                });
              }
              created.push({ id: acct.id, docs: s.docs });
            }
            return created;
          });

          for (const a of accounts) {
            const own = await withTenant(a.id, (c) => listActiveDocuments(c, a.id));
            if (own.length !== a.docs) return false;
            if (own.some((r) => r.business_account_id !== a.id)) return false;

            const self = await withTenant(a.id, (c) => findAccountById(c, a.id));
            if (!self || self.id !== a.id) return false;

            for (const other of accounts) {
              if (other.id === a.id) continue;
              const leakedDocs = await withTenant(a.id, (c) => listActiveDocuments(c, other.id));
              if (leakedDocs.length !== 0) return false;
              const leakedAcct = await withTenant(a.id, (c) => findAccountById(c, other.id));
              if (leakedAcct !== null) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 12 },
    );
  });
});
