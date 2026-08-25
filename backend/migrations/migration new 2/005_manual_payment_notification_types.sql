-- =============================================================================
-- 005_manual_payment_notification_types.sql
-- -----------------------------------------------------------------------------
-- The manual cash-flow (admin -> agent disbursement, agent -> farmer purchase
-- proof, and their confirmations) needs a few notification_type enum values
-- that weren't in the original schema. Postgres requires ADD VALUE to run
-- outside a transaction block, so each is guarded and idempotent.
--
-- Run this in the Supabase SQL editor (it executes statements individually).
-- Safe to re-run — ADD VALUE IF NOT EXISTS is a no-op when the value exists.
-- =============================================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_submitted';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_confirmed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_rejected';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'disbursement_recorded';
