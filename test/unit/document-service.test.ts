import { describe, it, expect, beforeEach } from 'vitest';
import { withSystem } from '../../src/db/pool.js';
import { resetData } from '../db-harness.js';
import { createBusinessAccount } from '../../src/db/repositories/accounts.js';
import {
  uploadDocument,
  retrieveDocument,
  listDocuments,
  deleteDocument,
  scanExpiringDocuments,
} from '../../src/documents/service.js';
import { MAX_DOCUMENT_BYTES } from '../../src/config/platform.js';
import { FileTooLargeError, NotFoundError } from '../../src/core/errors.js';

async function newAccount(name: string): Promise<string> {
  return withSystem(async (c) => (await createBusinessAccount(c, { name, tier: 'basic' })).id);
}

describe('Document Helper service', () => {
  beforeEach(async () => {
    await resetData();
  });

  it('uploads then retrieves byte-identical content (REQ 9.1, 9.3, RT2)', async () => {
    const accountId = await newAccount('Docs');
    const content = Buffer.from('GST certificate PDF bytes …', 'utf8');
    const doc = await uploadDocument(accountId, 'owner', {
      fileName: 'gst.pdf',
      docType: 'license',
      expiryDate: '2027-01-01',
      content,
    });
    const { content: restored } = await retrieveDocument(accountId, doc.id);
    expect(restored.equals(content)).toBe(true);
  });

  it('rejects files over 50 MB (REQ 9.6, ERR2)', async () => {
    const accountId = await newAccount('Big');
    const tooBig = Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 1);
    await expect(
      uploadDocument(accountId, 'owner', { fileName: 'big.bin', docType: null, expiryDate: null, content: tooBig }),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it('denies cross-tenant retrieval (REQ 16.4, ERR4)', async () => {
    const a = await newAccount('A');
    const b = await newAccount('B');
    const doc = await uploadDocument(a, 'owner', {
      fileName: 'a.pdf',
      docType: null,
      expiryDate: null,
      content: Buffer.from('A-only'),
    });
    await expect(retrieveDocument(b, doc.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a document from active storage (REQ 9.5)', async () => {
    const accountId = await newAccount('Del');
    const doc = await uploadDocument(accountId, 'owner', {
      fileName: 'x.pdf',
      docType: null,
      expiryDate: null,
      content: Buffer.from('bytes'),
    });
    await deleteDocument(accountId, 'owner', doc.id);
    expect(await listDocuments(accountId)).toHaveLength(0);
    await expect(retrieveDocument(accountId, doc.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('enqueues an expiry reminder for a document within 30 days, once (REQ 9.4)', async () => {
    const accountId = await newAccount('Exp');
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await uploadDocument(accountId, 'owner', {
      fileName: 'expiring.pdf',
      docType: 'license',
      expiryDate: soon,
      content: Buffer.from('bytes'),
    });
    expect(await scanExpiringDocuments()).toBe(1);
    expect(await scanExpiringDocuments()).toBe(0);
  });
});
