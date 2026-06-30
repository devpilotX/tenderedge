import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { assertCanWrite, canWrite, runWrite } from '../../src/auth/rbac.js';
import { ForbiddenError } from '../../src/core/errors.js';

describe('password hashing (argon2id)', () => {
  it('produces a verifiable argon2id hash and rejects wrong passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('never throws on a malformed stored hash', async () => {
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('RBAC roles', () => {
  it('permits writes for owner/manager and denies viewer', () => {
    expect(canWrite('owner')).toBe(true);
    expect(canWrite('manager')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
    expect(() => assertCanWrite('viewer')).toThrow(ForbiddenError);
    expect(() => assertCanWrite('owner')).not.toThrow();
  });

  it('runWrite blocks a viewer before the operation runs', async () => {
    let ran = false;
    await expect(
      runWrite('viewer', async () => {
        ran = true;
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ran).toBe(false);

    await expect(runWrite('manager', async () => 'ok')).resolves.toBe('ok');
  });
});
