import type { PoolClient } from 'pg';
import type { BusinessDocument } from '../entities.js';

/**
 * Tenant-scoped document repository. Every statement runs inside a withTenant()
 * transaction, so RLS guarantees rows belong to the caller's account (INV1, REQ 16.3/16.4).
 */
export interface InsertDocumentInput {
  businessAccountId: string;
  storageKey: string;
  fileName: string;
  docType: string | null;
  expiryDate: string | null;
  sizeBytes: number;
  contentSha256: string | null;
}

export async function insertDocument(
  client: PoolClient,
  input: InsertDocumentInput,
): Promise<BusinessDocument> {
  const { rows } = await client.query<BusinessDocument>(
    `INSERT INTO business_document
       (business_account_id, storage_key, file_name, doc_type, expiry_date, size_bytes, content_sha256)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      input.businessAccountId,
      input.storageKey,
      input.fileName,
      input.docType,
      input.expiryDate,
      input.sizeBytes,
      input.contentSha256,
    ],
  );
  return rows[0]!;
}

export async function listActiveDocuments(
  client: PoolClient,
  businessAccountId: string,
): Promise<BusinessDocument[]> {
  const { rows } = await client.query<BusinessDocument>(
    `SELECT * FROM business_document
     WHERE business_account_id = $1 AND deleted_at IS NULL
     ORDER BY uploaded_at DESC`,
    [businessAccountId],
  );
  return rows;
}

export async function findDocumentById(
  client: PoolClient,
  id: string,
): Promise<BusinessDocument | null> {
  const { rows } = await client.query<BusinessDocument>(
    `SELECT * FROM business_document WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

export async function softDeleteDocument(client: PoolClient, id: string): Promise<boolean> {
  const res = await client.query(
    `UPDATE business_document SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listDocumentsExpiringWithin(
  client: PoolClient,
  days: number,
): Promise<BusinessDocument[]> {
  const { rows } = await client.query<BusinessDocument>(
    `SELECT * FROM business_document
     WHERE deleted_at IS NULL
       AND expiry_date IS NOT NULL
       AND expiry_date <= (current_date + ($1 || ' days')::interval)
     ORDER BY expiry_date ASC`,
    [days],
  );
  return rows;
}
