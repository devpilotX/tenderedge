import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth, requireWrite } from '../middleware/auth.js';
import { getAccount } from '../../db/repositories/accounts.js';
import { configureFilters, getFilters, listMatches } from '../../match/service.js';
import { NotFoundError } from '../../core/errors.js';

const FilterSchema = z.object({
  regions: z.array(z.string().min(1)).max(200),
  productCategories: z.array(z.string().min(1)).max(200),
  minValue: z.number().nonnegative().nullish(),
  maxValue: z.number().nonnegative().nullish(),
});

export function matchRouter(): Router {
  const router = Router();

  // REQ 5.1 / 14.3 — configure target regions, categories, and value range (tier-limited).
  router.put(
    '/filters',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(FilterSchema, req.body);
      const account = await getAccount(auth.businessAccountId);
      if (!account) throw new NotFoundError('Account');
      await configureFilters(auth.businessAccountId, auth.role, account.subscription_tier, {
        regions: input.regions,
        productCategories: input.productCategories,
        minValue: input.minValue ?? null,
        maxValue: input.maxValue ?? null,
      });
      res.status(204).end();
    }),
  );

  router.get(
    '/filters',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const filter = await getFilters(auth.businessAccountId);
      res.json(filter ?? { regions: [], productCategories: [], minValue: null, maxValue: null });
    }),
  );

  // REQ 5.4 — matched tenders ordered by descending Match_Score.
  router.get(
    '/matches',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const page = Math.max(1, Number(req.query.page ?? '1') || 1);
      const pageSize = Math.max(1, Number(req.query.pageSize ?? '20') || 20);
      const matches = await listMatches(auth.businessAccountId, page, pageSize);
      res.json({ page, pageSize, matches });
    }),
  );

  return router;
}
