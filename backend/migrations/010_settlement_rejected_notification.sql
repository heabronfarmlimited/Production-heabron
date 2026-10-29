-- =============================================================================
-- 010_settlement_rejected_notification.sql
-- -----------------------------------------------------------------------------
-- `notification_type` had 'settlement_requested' and 'settlement_approved' but
-- no value for a REJECTED settlement, so an agent whose cash-out was refused
-- was never told: the request simply changed state in the admin dashboard and
-- the agent saw nothing in the app.
--
-- `admin.wallet.controller.decideSettlement` now inserts a
-- 'settlement_rejected' notification on the reject branch. Until this migration
-- runs, that insert fails the enum check; the failure is caught and logged and
-- the rejection itself still succeeds, so applying this is safe to do at any
-- time and is not a deploy blocker.
--
-- Postgres requires ADD VALUE to run outside a transaction block, so run this
-- in the Supabase SQL editor (it executes statements individually).
-- Safe to re-run — ADD VALUE IF NOT EXISTS is a no-op when the value exists.
-- =============================================================================

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'settlement_rejected';
