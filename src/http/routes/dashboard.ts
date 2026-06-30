import { Router } from 'express';
import { asyncHandler } from '../async-handler.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import { getAccount } from '../../db/repositories/accounts.js';
import { getDashboard } from '../../dashboard/service.js';
import { NotFoundError } from '../../core/errors.js';

export function dashboardRouter(): Router {
  const router = Router();

  // REQ 10.1–10.5 — single-screen summary for the account.
  router.get(
    '/summary',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const account = await getAccount(auth.businessAccountId);
      if (!account) throw new NotFoundError('Account');
      const summary = await getDashboard(auth.businessAccountId, account.subscription_tier);
      res.json({ account: { name: account.name, tier: account.subscription_tier }, ...summary });
    }),
  );

  return router;
}
