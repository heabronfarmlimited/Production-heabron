-- =============================================================================
-- 008_repayment_void.sql
-- -----------------------------------------------------------------------------
-- Repayments are auto-applied when a field agent submits them (they only ever
-- reduce the outstanding balance and improve the score). The correction path
-- for a wrong/mistaken entry is a VOID (reverse), not a delete — we keep the
-- row for audit but exclude it from balance + score math.
--
-- Adds: voided (bool), voided_at, voided_by_admin_id, void_reason.
-- All nullable / defaulted. Safe to re-run.
-- =============================================================================

ALTER TABLE public.repayment_records
  ADD COLUMN IF NOT EXISTS voided             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by_admin_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS void_reason        TEXT;

CREATE INDEX IF NOT EXISTS idx_repayment_records_active
  ON public.repayment_records (financing_request_id)
  WHERE voided = false;
