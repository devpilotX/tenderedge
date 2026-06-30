import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import { getAccount } from '../../db/repositories/accounts.js';
import { predict } from '../../bidbrain/service.js';
import { NotFoundError } from '../../core/errors.js';

const PredictQuery = z.object({
  sourcePortal: z.string().min(1),
  sourceIdentifier: z.string().min(1),
});

export function bidBrainRouter(): Router {
  const router = Router();

  // REQ 7.1, 7.2 — entitled accounts get a prediction; others receive an upgrade message (402).
  router.get(
    '/predict',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const { sourcePortal, sourceIdentifier } = parseOrThrow(PredictQuery, req.query);
      const account = await getAccount(auth.businessAccountId);
      if (!account) throw new NotFoundError('Account');
      const result = await predict({
        accountId: auth.businessAccountId,
        tier: account.subscription_tier,
        sourcePortal,
        sourceIdentifier,
      });
      res.json(result);
    }),
  );

  return router;
}
