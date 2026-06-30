-- UP
-- Non-superuser role the application uses for tenant-scoped queries.
-- Row-Level Security applies to this role (superusers/owners bypass RLS), which
-- is what makes tenant isolation (INV1) enforceable at the database layer.
-- Roles are cluster-global; guard against re-creation. Trust auth on localhost
-- means no password is required in development.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tenderedge_app') THEN
    CREATE ROLE tenderedge_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Allow the app role to use the schema.
GRANT USAGE ON SCHEMA public TO tenderedge_app;

-- Resolves the current tenant from the transaction-local GUC set by withTenant().
-- Returns NULL when unset/empty, so a query with no tenant context matches no rows.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.business_account_id', true), '')::uuid $$;

GRANT EXECUTE ON FUNCTION app_current_tenant() TO tenderedge_app;

-- DOWN
DROP FUNCTION IF EXISTS app_current_tenant();
-- Role is left in place (may be shared across databases in the cluster).
