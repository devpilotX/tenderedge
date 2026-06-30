import { randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSystem } from '../db/pool.js';
import { env } from '../config/env.js';
import {
  AuthenticationError,
  DuplicateEmailError,
  SessionExpiredError,
} from '../core/errors.js';
import type { SubscriptionTierName, UserRole } from '../db/entities.js';
import { createBusinessAccount, setAccountOwner } from '../db/repositories/accounts.js';
import { createUser, findUserByEmail, updateLastActive } from '../db/repositories/users.js';
import {
  createSession,
  findActiveSessionByTokenHash,
  revokeSession,
  revokeSessionByTokenHash,
  touchSession,
} from '../db/repositories/sessions.js';

export interface AuthContext {
  sessionId: string;
  businessAccountId: string;
  userId: string;
  role: UserRole;
}

export interface RegisterInput {
  businessName: string;
  email: string;
  password: string;
  tier?: SubscriptionTierName;
}

export interface LoginResult {
  sessionToken: string;
  role: UserRole;
  businessAccountId: string;
  userId: string;
}

function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function inactivityMs(): number {
  return env.SESSION_INACTIVITY_MINUTES * 60 * 1000;
}

/**
 * Registers a Business_Account with an owner user (REQ 1.1). The email is unique
 * platform-wide; a duplicate is rejected with a clear message (REQ 1.2, ERR1). The
 * unique index also guards against a race, which we map to the same error.
 */
export async function register(
  input: RegisterInput,
): Promise<{ businessAccountId: string; ownerUserId: string }> {
  const { hashPassword } = await import('./password.js');
  const passwordHash = await hashPassword(input.password);
  try {
    return await withSystem(async (client: PoolClient) => {
      const existing = await findUserByEmail(client, input.email);
      if (existing) throw new DuplicateEmailError(input.email);

      const account = await createBusinessAccount(client, {
        name: input.businessName,
        tier: input.tier ?? 'basic',
      });
      const owner = await createUser(client, {
        businessAccountId: account.id,
        email: input.email,
        passwordHash,
        role: 'owner',
      });
      await setAccountOwner(client, account.id, owner.id);
      return { businessAccountId: account.id, ownerUserId: owner.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DuplicateEmailError(input.email);
    throw err;
  }
}

/**
 * Authenticates credentials and issues a session token (REQ 2.1, 2.2). The raw
 * token is returned once; only its hash is stored. Invalid credentials yield a
 * generic authentication error (no account-existence leak).
 */
export async function login(input: { email: string; password: string }): Promise<LoginResult> {
  const { verifyPassword } = await import('./password.js');
  return withSystem(async (client) => {
    const user = await findUserByEmail(client, input.email);
    // Always run a verification to reduce timing differences between known/unknown emails.
    const hash = user?.password_hash ?? '$argon2id$v=19$m=19456,t=2,p=1$invalidsaltvalue$invalidhashvalue';
    const ok = await verifyPassword(hash, input.password);
    if (!user || !ok) throw new AuthenticationError();

    const { token, tokenHash } = generateToken();
    await createSession(client, {
      businessAccountId: user.business_account_id,
      userId: user.id,
      tokenHash,
    });
    await updateLastActive(client, user.id);
    return {
      sessionToken: token,
      role: user.role,
      businessAccountId: user.business_account_id,
      userId: user.id,
    };
  });
}

/**
 * Validates a bearer token and enforces 30-minute inactivity expiry (REQ 2.3).
 * On success the session activity is refreshed (sliding window). Expired or unknown
 * tokens raise SessionExpiredError; expired sessions are revoked in a committed
 * transaction so the revocation is durable even though we then throw.
 */
export async function validateSession(token: string): Promise<AuthContext> {
  const tokenHash = hashToken(token);
  const session = await withSystem((client) => findActiveSessionByTokenHash(client, tokenHash));
  if (!session) throw new SessionExpiredError();

  const idleMs = Date.now() - new Date(session.last_active_at).getTime();
  if (idleMs > inactivityMs()) {
    await withSystem((client) => revokeSession(client, session.id));
    throw new SessionExpiredError();
  }

  await withSystem(async (client) => {
    await touchSession(client, session.id);
    await updateLastActive(client, session.user_id);
  });
  return {
    sessionId: session.id,
    businessAccountId: session.business_account_id,
    userId: session.user_id,
    role: session.role,
  };
}

export async function logout(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await withSystem((client) => revokeSessionByTokenHash(client, tokenHash));
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}
