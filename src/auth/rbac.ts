import { ForbiddenError } from '../core/errors.js';
import type { UserRole } from '../db/entities.js';

/**
 * Role-based access control (REQ 2.4, 2.5).
 *
 * Exactly one role per user. `viewer` is strictly read-only: it may never cause a
 * state change (INV5). `manager` and `owner` may perform writes. Some owner-only
 * actions (billing, tier changes, deleting the account) are gated separately.
 */
export const ROLES: readonly UserRole[] = ['owner', 'manager', 'viewer'];

export function canWrite(role: UserRole): boolean {
  return role === 'owner' || role === 'manager';
}

export function isOwner(role: UserRole): boolean {
  return role === 'owner';
}

/** Throws ForbiddenError unless the role may perform create/update/delete (INV5). */
export function assertCanWrite(role: UserRole): void {
  if (!canWrite(role)) {
    throw new ForbiddenError('Your role is read-only and cannot modify data.');
  }
}

/** Throws ForbiddenError unless the role is owner (billing/account administration). */
export function assertOwner(role: UserRole): void {
  if (!isOwner(role)) {
    throw new ForbiddenError('Only the account owner can perform this action.');
  }
}

/**
 * Canonical write gate. Every state-changing service operation runs through this,
 * so a viewer-role caller can never cause a state change (INV5). The role check
 * happens before `op` runs, so no partial write is possible.
 */
export async function runWrite<T>(role: UserRole, op: () => Promise<T>): Promise<T> {
  assertCanWrite(role);
  return op();
}
