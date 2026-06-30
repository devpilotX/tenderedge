import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../async-handler.js';
import { parseOrThrow } from '../validate.js';
import { getAuth, requireAuth } from '../middleware/auth.js';
import { login, logout, register } from '../../auth/service.js';

const RegisterSchema = z.object({
  businessName: z.string().min(1).max(200),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  tier: z.enum(['basic', 'premium', 'enterprise']).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

export function authRouter(): Router {
  const router = Router();

  // REQ 1.1, 1.2 — create account + owner; reject duplicate emails.
  router.post(
    '/register',
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(RegisterSchema, req.body);
      const result = await register(input);
      res.status(201).json(result);
    }),
  );

  // REQ 2.1, 2.2 — authenticate and issue a session.
  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const input = parseOrThrow(LoginSchema, req.body);
      const result = await login(input);
      res.json(result);
    }),
  );

  // REQ 2.3 — validate and refresh activity.
  router.get(
    '/session',
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = getAuth(req);
      res.json({
        businessAccountId: auth.businessAccountId,
        userId: auth.userId,
        role: auth.role,
      });
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      const header = req.header('authorization') ?? '';
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (token) await logout(token);
      res.status(204).end();
    }),
  );

  return router;
}
