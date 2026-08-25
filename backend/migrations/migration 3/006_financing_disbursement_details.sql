-- =============================================================================
-- 006_financing_disbursement_details.sql
-- -----------------------------------------------------------------------------
-- When an admin marks a financing request as disbursed, they attach the
-- account details the money was sent to (or to be used by the agent) plus a
-- proof image/PDF. These columns let the field agent see that info on the
-- loan in their app. All nullable, safe to re-run.
-- =============================================================================

ALTER TABLE public.financing_requests
  ADD COLUMN IF NOT EXISTS disbursement_account_details TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_reference       TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_proof_urls      TEXT[];
