-- =============================================================================
-- 001_fix_otp_rls.sql
-- -----------------------------------------------------------------------------
-- Background:
--   The initial migration enables RLS on public.otp_codes and installs a
--   policy `otp_block` that uses `USING (false) WITH CHECK (false)`. The
--   intent (per the migration's own comment) is that the backend uses the
--   SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS, while end-user (anon)
--   clients can't touch the table.
--
--   That works ONLY when the backend is actually configured with the service
--   role key. If the anon key is used by mistake, every INSERT into otp_codes
--   silently fails (PostgREST returns 201 with no row written), which produces
--   a confusing "OTP not_found" on verify-otp.
--
-- This patch:
--   1. Drops the all-false policy.
--   2. Replaces it with an explicit policy that BLOCKS the anon and
--      authenticated roles but allows service_role full access.
--   3. Re-asserts RLS is enabled.
--
-- Run this once against your Supabase project (SQL Editor → New Query →
-- paste → Run). Safe to re-run.
-- =============================================================================

ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS otp_block        ON public.otp_codes;
DROP POLICY IF EXISTS otp_service_role ON public.otp_codes;
DROP POLICY IF EXISTS otp_deny_anon    ON public.otp_codes;

-- Explicit deny for anon and authenticated end-users.
CREATE POLICY otp_deny_anon ON public.otp_codes
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- Explicit allow for service_role (backend with SERVICE_ROLE_KEY).
-- service_role normally bypasses RLS, but this policy makes the intent
-- visible in the schema and provides correct behaviour if RLS is ever
-- forced on this table in future.
CREATE POLICY otp_service_role ON public.otp_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- Sanity check — after running this, you should be able to:
--
--   INSERT INTO public.otp_codes (email, code, purpose, expires_at)
--   VALUES ('rls.check@example.com', '000000', 'signup', now() + interval '5 min');
--
-- from the SQL editor (postgres superuser, RLS bypassed). And the Node
-- backend, when configured with the service_role key, must also be able to
-- insert. If your backend still can't insert after this patch, the issue is
-- that the wrong key (anon) is in your .env — the patched supabase.js will
-- now throw at startup in that case.
-- =============================================================================
