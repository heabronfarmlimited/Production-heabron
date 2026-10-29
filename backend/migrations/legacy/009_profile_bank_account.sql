-- =============================================================================
-- 009_profile_bank_account.sql
-- -----------------------------------------------------------------------------
-- Lets a field agent save a DEFAULT bank account on their profile so the
-- settlement-request form can pre-fill it instead of asking the user to
-- type the same bank details every cycle. Settlement requests still accept
-- explicit bank fields per submission (so an agent can override), this is
-- purely a stored default.
--
-- All nullable, safe to re-run.
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bank_name       TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name   TEXT;
