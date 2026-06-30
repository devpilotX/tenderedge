import type { PoolClient } from 'pg';
import type { UserRole } from '../entities.js';

/** A validated session joined with the user's role for authorization. */
export interface SessionRecord {
  id: string;
  business_account_id: string;
  user_id: string;
  role: UserRole;
  last_active_at: Date;
  revoked_at: Date | null;
}

export async function createSession(
  client: PoolClient,
  params: { businessAccountId: string; userId: string; tokenHash: string },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO user_session (business_account_id, user_id, token_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [params.businessAccountId, params.userId, params.tokenHash],
  );
  return rows[0]!;
}

/**
 * Looks up an active session by token hash, joining the user's current role.
 * Returns null if missing or already revoked. Inactivity expiry is evaluated by
 * the caller against last_active_at.
 */
export async function findActiveSessionByTokenHash(
  client: PoolClient,
  tokenHash: string,
): Promise<SessionRecord | null> {
  const { rows } = await client.query<SessionRecord>(
    `SELECT s.id, s.business_account_id, s.user_id, u.role, s.last_active_at, s.revoked_at
     FROM user_session s
     JOIN business_user u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchSession(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(`UPDATE user_session SET last_active_at = now() WHERE id = $1`, [sessionId]);
}

export async function revokeSession(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(`UPDATE user_session SET revoked_at = now() WHERE id = $1`, [sessionId]);
}

export async function revokeSessionByTokenHash(
  client: PoolClient,
  tokenHash: string,
): Promise<void> {
  await client.query(
    `UPDATE user_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
}
