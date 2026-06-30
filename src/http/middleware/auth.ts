import type { NextFunction, Request, Response } from 'express';
import { validateSession, type AuthContext } from '../../auth/service.js';
import { assertCanWrite, assertOwner } from '../../auth/rbac.js';
import { SessionExpiredError } from '../../core/errors.js';
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

/** Denies create/update/delete for the viewer role (REQ 2.5, INV5). */
export function requireWrite(req: Request, _res: Response, next: NextFunction): void {
  assertCanWrite(getAuth(req).role);
  next();
}

/** Restricts a route to the account owner (billing/account administration). */
export function requireOwner(req: Request, _res: Response, next: NextFunction): void {
  assertOwner(getAuth(req).role);
  next();
}
