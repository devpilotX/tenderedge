import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth, requireOwner } from '../middleware/auth.js';
import {
  changeTier,
  getAccountSubscription,
  runBillingCycle,
  selectRegionsForDowngrade,
  subscribe,
} from '../../billing/service.js';

const TierSchema = z.object({ tier: z.enum(['basic', 'premium', 'enterprise']) });
const SelectRegionsSchema = z.object({
  tier: z.enum(['basic', 'premium', 'enterprise']),
  regions: z.array(z.string().min(1)).max(200),
});

export function billingRouter(): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      res.json({ subscription: await getAccountSubscription(auth.businessAccountId) });
    }),
  );

  // REQ 13.1, 13.2 — subscribe and grant entitlements (owner-only).
  router.post(
    '/subscribe',
    requireAuth,
    requireOwner,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const { tier } = parseOrThrow(TierSchema, req.body);
      const sub = await subscribe(auth.businessAccountId, auth.role, tier);
      res.status(201).json(sub);
    }),
  );

  // REQ 13.6, 13.7 — change tier at next cycle; downgrade may require region selection.
  router.post(
    '/change-tier',
    requireAuth,
    requireOwner,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const { tier } = parseOrThrow(TierSchema, req.body);
      const result = await changeTier(auth.businessAccountId, auth.role, tier);
      res.status(result.needsRegionSelection ? 409 : 200).json(result);
    }),
  );

  router.post(
    '/select-regions',
    requireAuth,
    requireOwner,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const { tier, regions } = parseOrThrow(SelectRegionsSchema, req.body);
      await selectRegionsForDowngrade(auth.businessAccountId, auth.role, tier, regions);
      res.status(204).end();
    }),
  );

  // Manual charge to (re)activate — allowed even when read-only so owners can recover.
  router.post(
    '/pay',
    requireAuth,
    requireOwner,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const outcome = await runBillingCycle(auth.businessAccountId);
      res.json(outcome);
    }),
  );

  return router;
}
