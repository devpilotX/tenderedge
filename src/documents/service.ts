import { randomUUID, createHash } from 'node:crypto';
import { withSystem, withTenant } from '../db/pool.js';
import { runWrite } from '../auth/rbac.js';
import { MAX_DOCUMENT_BYTES, DOCUMENT_EXPIRY_REMINDER_DAYS } from '../config/platform.js';
import { FileTooLargeError, NotFoundError } from '../core/errors.js';
import type { BusinessDocument, UserRole } from '../db/entities.js';
import {
  findDocumentById,
  insertDocument,
  listActiveDocuments,
  listDocumentsExpiringWithin,
  softDeleteDocument,
} from '../db/repositories/documents.js';
import { getStorageDriver } from '../storage/index.js';
import { notifyAccount } from '../notifications/notify.js';
import { childLogger } from '../core/logger.js';

const log = childLogger({ component: 'document-helper' });

export interface UploadInput {
  fileName: string;
  docType: string | null;
  expiryDate: string | null; // YYYY-MM-DD
  content: Buffer;
}

/**
 * Stores an uploaded Business_Document encrypted at rest and scoped to the account
 * (REQ 9.1, 9.2, 16.1). Rejects files over 50 MB (REQ 9.6, ERR2). Write-gated.
 */
export async function uploadDocument(
  accountId: string,
  role: UserRole,
  input: UploadInput,
): Promise<BusinessDocument> {
  return runWrite(role, async () => {
    if (input.content.length > MAX_DOCUMENT_BYTES) {
      throw new FileTooLargeError(MAX_DOCUMENT_BYTES);
    }
    const storageKey = randomUUID().replace(/-/g, '');
    const sha = createHash('sha256').update(input.content).digest('hex');
    await getStorageDriver().put(storageKey, input.content);
    const doc = await withTenant(accountId, (c) =>
      insertDocument(c, {
        businessAccountId: accountId,
        storageKey,
        fileName: input.fileName,
        docType: input.docType,
        expiryDate: input.expiryDate,
        sizeBytes: input.content.length,
        contentSha256: sha,
      }),
    );
    log.debug({ account: accountId, doc: doc.id, bytes: input.content.length }, 'document uploaded');
    return doc;
  });
}

export async function listDocuments(accountId: string): Promise<BusinessDocument[]> {
  return withTenant(accountId, (c) => listActiveDocuments(c, accountId));
}

/**
 * Retrieves a document's decrypted bytes after authorizing it against the caller's
 * account (REQ 16.3). A document in another account (or absent) yields not-found —
 * cross-tenant access is silently denied (REQ 16.4, ERR4) because RLS hides the row.
 */
export async function retrieveDocument(
  accountId: string,
  documentId: string,
): Promise<{ document: BusinessDocument; content: Buffer }> {
  const document = await withTenant(accountId, (c) => findDocumentById(c, documentId));
  if (!document) throw new NotFoundError('Document');
  const content = await getStorageDriver().get(document.storage_key);
  return { document, content };
}

/** Removes a document from active storage for the account (REQ 9.5). */
export async function deleteDocument(
  accountId: string,
  role: UserRole,
  documentId: string,
): Promise<void> {
  await runWrite(role, async () => {
    const document = await withTenant(accountId, (c) => findDocumentById(c, documentId));
    if (!document) throw new NotFoundError('Document');
    await withTenant(accountId, (c) => softDeleteDocument(c, documentId));
    await getStorageDriver().delete(document.storage_key).catch(() => undefined);
  });
}

/**
 * Enqueues expiry reminders for documents within the reminder window (REQ 9.4).
 * Idempotent per document via dedupe key. Runs cross-tenant in the system context.
 * Returns the number of reminders enqueued.
 */
export async function scanExpiringDocuments(): Promise<number> {
  let fired = 0;
  await withSystem(async (client) => {
    const expiring = await listDocumentsExpiringWithin(client, DOCUMENT_EXPIRY_REMINDER_DAYS);
    for (const doc of expiring) {
      fired += await notifyAccount(client, {
        accountId: doc.business_account_id,
        type: 'document_expiry',
        dedupeKey: `doc-expiry:${doc.id}`,
        payload: { documentId: doc.id, fileName: doc.file_name, expiryDate: doc.expiry_date },
      });
    }
  });
  if (fired > 0) log.info({ fired }, 'enqueued document expiry reminders');
  return fired;
}
