-- =============================================================================
-- 002_fix_grants.sql
-- -----------------------------------------------------------------------------
-- Background:
--   The initial migration enables RLS on every table but does not explicitly
--   GRANT base SQL privileges to the standard Supabase roles. Without those
--   grants, Postgres rejects writes with "permission denied for table X"
--   (SQLSTATE 42501) BEFORE RLS policies get a chance to evaluate.
--
--   The backend uses SUPABASE_SERVICE_ROLE_KEY, which authenticates as the
--   `service_role` Postgres role. That role needs SELECT/INSERT/UPDATE/DELETE
--   on every table the backend touches. RLS still applies to authenticated
--   end-users (anon, authenticated); we just need to make sure the database
--   privilege layer permits the operation in the first place.
--
-- This patch:
--   1. Grants USAGE on the `public` schema to the three Supabase roles.
--   2. Grants full DML privileges to service_role on every existing table.
--   3. Grants matching sequence privileges (for any SERIAL/IDENTITY columns).
--   4. Sets future tables to inherit the same grants.
--
-- Safe to run multiple times.
-- =============================================================================

-- 1. Schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Full DML for the backend (service_role bypasses RLS by design).
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public
  TO service_role;

-- anon / authenticated still get reads where policies allow; RLS gates the rest.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated;

GRANT SELECT
  ON ALL TABLES IN SCHEMA public
  TO anon;

-- 3. Sequences (gen_random_uuid() is a function so most PKs don't need this,
--    but if any table uses an integer SERIAL we cover it).
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA public
  TO service_role, authenticated;

-- 4. Default privileges for any tables/sequences created later by the
--    `postgres` role (the role Supabase migrations run as).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT
  ON TABLES TO anon;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE
  ON SEQUENCES TO service_role, authenticated;

-- -----------------------------------------------------------------------------
-- Sanity check — confirm service_role can now write to otp_codes.
-- After this runs, the next /api/auth/signup call should succeed and you'll
-- see a row in otp_codes for the email you signed up with.
-- -----------------------------------------------------------------------------

-- Verify the grant landed:
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'otp_codes'
  AND grantee = 'service_role'
ORDER BY privilege_type;
-- Expected output: rows for SELECT, INSERT, UPDATE, DELETE (and likely more).
