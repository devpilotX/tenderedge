-- UP
-- Server-side session store (REQ 2.1, 2.3). Sliding inactivity expiry is enforced
-- against last_active_at; only a SHA-256 hash of the bearer token is stored, never
-- the token itself. Sessions are looked up by token before the tenant is known, so
-- this table is accessed via the system context and is not tenant-RLS-scoped.
CREATE TABLE user_session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id uuid NOT NULL REFERENCES business_account(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES business_user(id) ON DELETE CASCADE,
  token_hash          text NOT NULL UNIQUE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_active_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at          timestamptz
);
CREATE INDEX user_session_user_idx ON user_session (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_session TO tenderedge_app;

-- DOWN
DROP TABLE IF EXISTS user_session;
