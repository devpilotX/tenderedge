import { describe, it, expect, beforeEach } from 'vitest';
import { register, login, validateSession, logout } from '../../src/auth/service.js';
import { getAccountSystem } from '../../src/db/repositories/accounts.js';
import { getAdminPool, withSystem } from '../../src/db/pool.js';
import { findActiveSessionByTokenHash } from '../../src/db/repositories/sessions.js';
import { DuplicateEmailError, AuthenticationError, SessionExpiredError } from '../../src/core/errors.js';
import { createHash } from 'node:crypto';
import { resetData } from '../db-harness.js';

beforeEach(async () => {
  await resetData();
});

describe('Auth & Tenant Service', () => {
  it('registers an account with an owner user and the chosen tier (REQ 1.1)', async () => {
    const { businessAccountId, ownerUserId } = await register({
      businessName: 'Sharma Industrial Couplings',
      email: 'owner@sharma.example',
      password: 'supersecret123',
      tier: 'premium',
    });
    expect(businessAccountId).toBeTruthy();
    expect(ownerUserId).toBeTruthy();

    const account = await getAccountSystem(businessAccountId);
    expect(account?.subscription_tier).toBe('premium');
    expect(account?.owner_user_id).toBe(ownerUserId);
  });

  it('rejects duplicate-email registration (REQ 1.2, ERR1)', async () => {
    await register({ businessName: 'A', email: 'dup@x.example', password: 'password12' });
    await expect(
      register({ businessName: 'B', email: 'DUP@x.example', password: 'password34' }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('grants a session on valid credentials and denies invalid ones (REQ 2.1, 2.2)', async () => {
    await register({ businessName: 'A', email: 'login@x.example', password: 'password12' });

    await expect(login({ email: 'login@x.example', password: 'wrong' })).rejects.toBeInstanceOf(
      AuthenticationError,
    );

    const res = await login({ email: 'login@x.example', password: 'password12' });
    expect(res.sessionToken).toBeTruthy();
    expect(res.role).toBe('owner');

    const ctx = await validateSession(res.sessionToken);
    expect(ctx.businessAccountId).toBe(res.businessAccountId);
    expect(ctx.role).toBe('owner');
  });

  it('invalidates a session after 30 minutes of inactivity (REQ 2.3)', async () => {
    await register({ businessName: 'A', email: 'idle@x.example', password: 'password12' });
    const res = await login({ email: 'idle@x.example', password: 'password12' });
    const tokenHash = createHash('sha256').update(res.sessionToken).digest('hex');

    // Simulate 31 minutes of inactivity.
    await getAdminPool().query(
      `UPDATE user_session SET last_active_at = now() - interval '31 minutes' WHERE token_hash = $1`,
      [tokenHash],
    );

    await expect(validateSession(res.sessionToken)).rejects.toBeInstanceOf(SessionExpiredError);
    const stillActive = await withSystem((c) => findActiveSessionByTokenHash(c, tokenHash));
    expect(stillActive).toBeNull();
  });

  it('logout revokes the session', async () => {
    await register({ businessName: 'A', email: 'out@x.example', password: 'password12' });
    const res = await login({ email: 'out@x.example', password: 'password12' });
    await logout(res.sessionToken);
    await expect(validateSession(res.sessionToken)).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
