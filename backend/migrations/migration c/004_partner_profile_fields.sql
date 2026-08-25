-- =============================================================================
-- 004_partner_profile_fields.sql
-- -----------------------------------------------------------------------------
-- The partner profile screen (per the partner_screens spec) shows Website,
-- Tax ID, and a Contact Name in the Organization Information block. The base
-- partners table didn't include these. Add them (nullable). Safe to re-run.
-- =============================================================================

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS website      TEXT,
  ADD COLUMN IF NOT EXISTS tax_id       TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT;
