import type { NextFunction, Request, Response } from 'express';
import { validateSession, type AuthContext } from '../../auth/service.js';
import { assertCanWrite, assertOwner } from '../../auth/rbac.js';
import { ForbiddenError, SessionExpiredError } from '../../core/errors.js';
import { getAccountSystem } from '../../db/repositories/accounts.js';
import { asyncHandler } from '../async-handler.js';
import './../types.js';

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (header && header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return null;
}

/** Validates the bearer token, enforces inactivity expiry, and attaches req.auth. */
export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearer(req);
  if (!token) throw new SessionExpiredError('Authentication required.');
  req.auth = await validateSession(token);
  next();
});

/** Convenience accessor that asserts the request is authenticated. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw new SessionExpiredError('Authentication required.');
  return req.auth;
}

/**
 * Denies create/update/delete for the viewer role (REQ 2.5, INV5) and for accounts
 * restricted to read-only by unpaid billing (REQ 13.5). Billing/recovery routes use
 * requireOwner instead so an owner can still pay to reactivate.
 */
export const requireWrite = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  assertCanWrite(auth.role);
  const account = await getAccountSystem(auth.businessAccountId);
  if (account?.status === 'read_only') {
    throw new ForbiddenError('Account is read-only due to an unpaid subscription. Please update billing.');
  }
  next();
});

/** Restricts a route to the account owner (billing/account administration). */
export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  assertOwner(getAuth(req).role);
  next();
}
