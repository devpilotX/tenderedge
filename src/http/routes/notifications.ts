import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth, requireWrite } from '../middleware/auth.js';
import {
  getChannelPreferences,
  listNotifications,
  setChannelPreference,
} from '../../notifications/service.js';

const PrefSchema = z.object({
  channel: z.enum(['email', 'sms', 'in_app']),
  enabled: z.boolean(),
});

export function notificationRouter(): Router {
  const router = Router();

  // REQ 12 — list the account's notifications (delivered/pending/failed).
  router.get(
    '/',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      res.json({ notifications: await listNotifications(auth.businessAccountId) });
    }),
  );

  router.get(
    '/prefs',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      res.json({ prefs: await getChannelPreferences(auth.businessAccountId) });
    }),
  );

  // REQ 12.4 — enable/disable a channel.
  router.put(
    '/prefs',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(PrefSchema, req.body);
      await setChannelPreference(auth.businessAccountId, auth.role, input.channel, input.enabled);
      res.status(204).end();
    }),
  );

  return router;
}
