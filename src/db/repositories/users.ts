import type { PoolClient } from 'pg';
import type { BusinessUser, UserRole } from '../entities.js';

/**
 * Users repository.
 *
 * Registration and login operate cross-tenant (no tenant context exists yet) and
 * therefore run through withSystem(); the email lookup spans all accounts. Reads of
 * the current user run tenant-scoped under withTenant().
 */
export interface CreateUserInput {
  businessAccountId: string;
  email: string;
  passwordHash: string;
  role: UserRole;
}

export async function createUser(
  client: PoolClient,
  input: CreateUserInput,
): Promise<BusinessUser> {
  const { rows } = await client.query<BusinessUser>(
    `INSERT INTO business_user (business_account_id, email, password_hash, role)
     VALUES ($1, lower($2), $3, $4)
     RETURNING *`,
    [input.businessAccountId, input.email, input.passwordHash, input.role],
  );
  return rows[0]!;
}

/** Cross-tenant lookup by email (system context) — used for login and dup-email checks. */
export async function findUserByEmail(
  client: PoolClient,
  email: string,
): Promise<BusinessUser | null> {
  const { rows } = await client.query<BusinessUser>(
    `SELECT * FROM business_user WHERE email = lower($1)`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(
  client: PoolClient,
  id: string,
): Promise<BusinessUser | null> {
  const { rows } = await client.query<BusinessUser>(`SELECT * FROM business_user WHERE id = $1`, [
    id,
  ]);
  return rows[0] ?? null;
}

export async function listUsersForAccount(
  client: PoolClient,
  businessAccountId: string,
): Promise<BusinessUser[]> {
  const { rows } = await client.query<BusinessUser>(
    `SELECT * FROM business_user WHERE business_account_id = $1 ORDER BY created_at`,
    [businessAccountId],
  );
  return rows;
}

export async function updateLastActive(client: PoolClient, userId: string): Promise<void> {
  await client.query(`UPDATE business_user SET last_active_at = now() WHERE id = $1`, [userId]);
}
