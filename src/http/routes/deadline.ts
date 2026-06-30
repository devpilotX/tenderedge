import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth, requireWrite } from '../middleware/auth.js';
import { configureReminders, listPursued, pursue, setStage, unpursue } from '../../deadline/service.js';

const PursueSchema = z.object({
  sourcePortal: z.string().min(1),
  sourceIdentifier: z.string().min(1),
  trackedDeadline: z.string().datetime().nullish(),
  reminderOffsetsDays: z.array(z.number().int().positive()).max(20).nullish(),
  stage: z.enum(['watching', 'preparing', 'submitted', 'won', 'lost', 'closed']).optional(),
});

const IdentitySchema = z.object({
  sourcePortal: z.string().min(1),
  sourceIdentifier: z.string().min(1),
});

const StageSchema = IdentitySchema.extend({
  stage: z.enum(['watching', 'preparing', 'submitted', 'won', 'lost', 'closed']),
});

const RemindersSchema = IdentitySchema.extend({
  reminderOffsetsDays: z.array(z.number().int().positive()).min(1).max(20),
});

export function deadlineRouter(): Router {
  const router = Router();

  // REQ 8.1 — save a tender to pursue and track its deadline.
  router.post(
    '/pursue',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(PursueSchema, req.body);
      const row = await pursue(auth.businessAccountId, auth.role, {
        sourcePortal: input.sourcePortal,
        sourceIdentifier: input.sourceIdentifier,
        trackedDeadline: input.trackedDeadline ?? null,
        reminderOffsetsDays: input.reminderOffsetsDays ?? null,
        stage: input.stage,
      });
      res.status(201).json(row);
    }),
  );

  router.delete(
    '/pursue',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(IdentitySchema, req.body);
      await unpursue(auth.businessAccountId, auth.role, input.sourcePortal, input.sourceIdentifier);
      res.status(204).end();
    }),
  );

  router.get(
    '/pursued',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      res.json({ pursued: await listPursued(auth.businessAccountId) });
    }),
  );

  router.patch(
    '/stage',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(StageSchema, req.body);
      await setStage(auth.businessAccountId, auth.role, input.sourcePortal, input.sourceIdentifier, input.stage);
      res.status(204).end();
    }),
  );

  // REQ 8.4 — configure custom reminder intervals.
  router.put(
    '/reminders',
    requireAuth,
    requireWrite,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      const input = parseOrThrow(RemindersSchema, req.body);
      await configureReminders(
        auth.businessAccountId,
        auth.role,
        input.sourcePortal,
        input.sourceIdentifier,
        input.reminderOffsetsDays,
      );
      res.status(204).end();
    }),
  );

  return router;
}
