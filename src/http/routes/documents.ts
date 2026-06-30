import express, { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth, requireWrite } from '../middleware/auth.js';
import { ValidationError } from '../../core/errors.js';
import {
  deleteDocument,
  listDocuments,
  retrieveDocument,
  uploadDocument,
} from '../../documents/service.js';

const UploadQuery = z.object({
  fileName: z.string().min(1).max(255),
  docType: z.string().max(80).optional(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export function documentRouter(): Router {
  const router = Router();

  // REQ 9.1, 9.2, 9.6 — upload raw file bytes (Content-Type-agnostic) with metadata in query.
  router.post(
    '/',
    requireAuth,
    requireWrite,
    express.raw({ type: () => true, limit: '60mb' }),
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const meta = parseOrThrow(UploadQuery, req.query);
      const content = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (content.length === 0) throw new ValidationError('Empty upload body.');
      const doc = await uploadDocument(auth.businessAccountId, auth.role, {
        fileName: meta.fileName,
        docType: meta.docType ?? null,
        expiryDate: meta.expiryDate ?? null,
        content,
      });
      res.status(201).json(toMeta(doc));
    }),
  );

  // REQ 9.3 — list active documents for the account.
  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const docs = await listDocuments(auth.businessAccountId);
      res.json({ documents: docs.map(toMeta) });
    }),
  );

  // REQ 16.3, 16.4 — authorized retrieval; cross-tenant/absent yields 404.
  router.get(
    '/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const { document, content } = await retrieveDocument(auth.businessAccountId, String(req.params.id));
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${document.file_name.replace(/"/g, '')}"`,
      );
      res.send(content);
    }),
  );

  // REQ 9.5 — delete from active storage.
  router.delete(
    '/:id',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      await deleteDocument(auth.businessAccountId, auth.role, String(req.params.id));
      res.status(204).end();
    }),
  );

  return router;
}

function toMeta(d: {
  id: string;
  file_name: string;
  doc_type: string | null;
  expiry_date: string | null;
  size_bytes: string;
  uploaded_at: Date;
}) {
  return {
    id: d.id,
    fileName: d.file_name,
    docType: d.doc_type,
    expiryDate: d.expiry_date,
    sizeBytes: Number(d.size_bytes),
    uploadedAt: d.uploaded_at,
  };
}
