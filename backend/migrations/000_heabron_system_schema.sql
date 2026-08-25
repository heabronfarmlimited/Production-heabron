-- =============================================================================
-- HEABRON COOPSCORE — CONSOLIDATED SYSTEM MIGRATION  (single file, idempotent)
-- =============================================================================
-- Run once in the Supabase SQL Editor (New query -> paste -> Run).
--
-- This ONE file replaces every prior migration (000-009 and the scattered
-- "migration */" folders). It is safe to run on:
--   * a brand-new database (creates everything), and
--   * an existing database (CREATE ... IF NOT EXISTS + ADD COLUMN IF NOT EXISTS
--     bring it up to date without touching existing data).
--
-- Sections:
--   1.  Extensions
--   2.  Enum types
--   3.  Core tables (users, partners, cooperatives, farmers, farm profiles)
--   4.  Production / yield-verification / deliveries / market / field notes
--   5.  Financing / repayments (manual payment flow)
--   6.  Credit scoring (Yield 60 / Repayment 40 model)
--   7.  Wallet / settlements (kept ready; manual flow is the active one)
--   8.  Notifications / activity / imports / change requests / OTP
--   9.  Upgrade-safe column additions (no-ops on a fresh DB)
--   10. Indexes
--   11. Helper functions + triggers
--   12. Row Level Security (RLS) + grants
--   13. Storage buckets
--   14. Seed data + backfills
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- 2. ENUM TYPES  (each guarded so re-running never errors)
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('super_admin','ops_admin','finance_admin','field_agent','partner_admin','partner_analyst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('pending','active','suspended','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gender_type AS ENUM ('male','female','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('pending','verified','mismatch','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Yield-verification has its own 3-state lifecycle (Pending / Verified / Rejected)
DO $$ BEGIN
  CREATE TYPE public.yield_verification_status AS ENUM ('pending','verified','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.financing_status AS ENUM ('pending','approved','rejected','disbursed','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending','paid','overdue','defaulted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credit_tier AS ENUM ('A','B','C','D');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_status AS ENUM ('active','frozen','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_type AS ENUM ('credit','debit','settlement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('pending','completed','failed','reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_status AS ENUM ('pending','approved','rejected','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.change_request_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- notification_type: full set INCLUDING the manual-payment values.
DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'agent_application_submitted','agent_approved','agent_rejected',
    'financing_request_submitted','financing_approved','financing_rejected','financing_disbursed',
    'repayment_recorded','delivery_logged','farmer_added','cooperative_added',
    'credit_score_updated','partner_invited','partner_password_reset',
    'settlement_requested','settlement_approved',
    'cash_purchase_submitted','cash_purchase_confirmed','cash_purchase_rejected','disbursement_recorded',
    'change_request_submitted','change_request_approved','change_request_rejected',
    'yield_verification_submitted','yield_verified','yield_rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Upgrade safety: if notification_type already existed (older DB) without the
-- newer values, add them. ADD VALUE IF NOT EXISTS is a no-op when present and
-- PG12+ permits it; we never use these values inside this migration.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_submitted';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_confirmed';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'cash_purchase_rejected';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'disbursement_recorded';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'change_request_submitted';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'change_request_approved';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'change_request_rejected';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'yield_verification_submitted';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'yield_verified';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'yield_rejected';

-- =============================================================================
-- 3. CORE TABLES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role        app_role NOT NULL DEFAULT 'field_agent',
  partner_id  UUID,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  email                TEXT,
  phone                TEXT,
  avatar_url           TEXT,
  state                TEXT,
  lga                  TEXT,
  status               user_status DEFAULT 'pending',
  must_change_password BOOLEAN DEFAULT false,
  last_login_at        TIMESTAMPTZ,
  -- default bank account (settlement pre-fill) — from 009
  bank_name            TEXT,
  bank_account_number  TEXT,
  bank_account_name    TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_applications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name                TEXT NOT NULL,
  email                    TEXT NOT NULL,
  phone                    TEXT,
  nin                      TEXT,
  date_of_birth            DATE,
  state                    TEXT,
  lga                      TEXT,
  selfie_url               TEXT,
  nin_verification_status  verification_status DEFAULT 'pending',
  nin_verification_payload JSONB,
  selfie_verified          BOOLEAN DEFAULT false,
  status                   user_status DEFAULT 'pending',
  rejection_reason         TEXT,
  reviewed_by              UUID REFERENCES auth.users(id),
  reviewed_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partners (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name   TEXT NOT NULL,
  organization_email  TEXT NOT NULL UNIQUE,
  logo_url            TEXT,
  contact_phone       TEXT,
  contact_name        TEXT,                 -- from 004
  website             TEXT,                 -- from 004
  tax_id              TEXT,                 -- from 004
  address             TEXT,
  state               TEXT,
  status              user_status DEFAULT 'active',
  created_by_admin_id UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- user_roles.partner_id FK (guarded so re-runs don't duplicate the constraint)
DO $$ BEGIN
  ALTER TABLE public.user_roles
    ADD CONSTRAINT fk_user_roles_partner
    FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cooperatives (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  registration_number  TEXT UNIQUE,
  leader_name          TEXT,
  leader_phone         TEXT,
  total_members        INTEGER DEFAULT 0,
  -- Crop model: the cooperative's main crop is the "primary crop"; the array
  -- keeps every crop the coop supports. Individual farmers add their own
  -- secondary crops on farm_profiles.
  primary_crop         TEXT,
  crops_supported      TEXT[],
  state                TEXT,
  lga                  TEXT,
  address              TEXT,
  estimated_land_size  NUMERIC(10,2),
  logo_url             TEXT,
  gps_lat              NUMERIC(10,8),
  gps_lng              NUMERIC(11,8),
  gps_polygon          JSONB,
  cooperative_tier     credit_tier,
  average_credit_score NUMERIC(5,2) DEFAULT 0,
  created_by_agent_id  UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farmers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id           UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  full_name                TEXT NOT NULL,
  date_of_birth            DATE,
  gender                   gender_type,
  phone                    TEXT,
  alt_phone                TEXT,
  address                  TEXT,
  state                    TEXT,
  lga                      TEXT,
  household_size           INTEGER DEFAULT 1,
  dependents               INTEGER DEFAULT 0,
  education_level          TEXT,
  nin                      TEXT,
  bvn                      TEXT,
  id_image_url             TEXT,
  farmer_photo_url         TEXT,
  nin_verification_status  verification_status DEFAULT 'pending',
  nin_verification_payload JSONB,
  -- BVN linkage (lenders show "BVN linked")
  bvn_verification_status  verification_status DEFAULT 'pending',
  bvn_verified_at          TIMESTAMPTZ,
  verified_at              TIMESTAMPTZ,
  verified_by_agent_id     UUID,
  -- "Member since" (date the farmer joined the cooperative / platform)
  member_since             DATE,
  credit_score             NUMERIC(5,2) DEFAULT 0,
  credit_tier              credit_tier,
  created_by_agent_id      UUID REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farm_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id           UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  farm_size_acres     NUMERIC(10,2),
  -- Farm location / mapping. gps_polygon stores GeoJSON-style coordinate rings
  -- drawn in the mobile app; farm_size_acres can be derived from it server-side.
  gps_lat             NUMERIC(10,8),
  gps_lng             NUMERIC(11,8),
  gps_polygon         JSONB,
  gps_mapped          BOOLEAN DEFAULT false,
  computed_area_acres NUMERIC(10,2),         -- area calculated from gps_polygon
  plot_count          INTEGER DEFAULT 1,
  -- Canonical soil types (enforced in app validators):
  --   sandy | lateritic_red_brown | forest | alluvial | hydromorphic_fadama
  soil_type           TEXT,
  irrigation_access   BOOLEAN DEFAULT false,
  -- Canonical water sources: rain_fed (default) | artificial_irrigation | river_stream | well
  water_source        TEXT DEFAULT 'rain_fed',
  -- crop_type = this farmer's PRIMARY crop; secondary_crops = 1..7 extra crops
  crop_type           TEXT,
  secondary_crops     TEXT[],
  land_ownership      TEXT,
  years_experience    INTEGER DEFAULT 0,     -- "Seasons farmed"
  farm_photo_urls     TEXT[],
  land_document_url   TEXT,
  land_document_type  TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 4. PRODUCTION / YIELD VERIFICATION / DELIVERIES / MARKET / FIELD NOTES
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.seasonal_productions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id               UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  cycle_number            INTEGER DEFAULT 1,
  season                  TEXT,                       -- e.g. "2025 Early Wet Planting"
  crop                    TEXT,
  farm_size_acres         NUMERIC(10,2),              -- size cultivated this season
  expected_planting_date  DATE,
  expected_harvest_date   DATE,
  expected_yield_tonnes   NUMERIC(10,2),
  actual_yield_tonnes     NUMERIC(10,2),
  benchmark_yield_tonnes  NUMERIC(10,2),
  yield_ratio             NUMERIC(5,4),               -- actual / benchmark (capped at 1.0 by engine)
  -- Auto-computed metrics (vs the farmer's own expectation)
  yield_variance_tonnes    NUMERIC(12,2) GENERATED ALWAYS AS (
                             COALESCE(actual_yield_tonnes,0) - COALESCE(expected_yield_tonnes,0)
                           ) STORED,
  yield_achievement_rate   NUMERIC(7,4) GENERATED ALWAYS AS (
                             CASE WHEN expected_yield_tonnes IS NOT NULL AND expected_yield_tonnes > 0
                                  THEN ROUND(actual_yield_tonnes / expected_yield_tonnes, 4)
                                  ELSE NULL END
                           ) STORED,
  -- Yield Verification Module (primary source for CoopScore yield performance)
  harvest_date             DATE,
  harvest_photo_urls       TEXT[],
  warehouse_receipt_url    TEXT,
  buyer_receipt_url        TEXT,
  verification_status      yield_verification_status DEFAULT 'pending',
  verification_notes       TEXT,
  verified_by_agent_id     UUID REFERENCES auth.users(id),
  verification_date        TIMESTAMPTZ,
  agent_signature_url      TEXT,
  yield_verified_by_agent  BOOLEAN DEFAULT false,     -- legacy flag kept for back-compat
  -- Input usage (Yield-history tab)
  seed_type                TEXT,
  fertilizer_used          TEXT,
  herbicide_used           BOOLEAN,
  post_harvest_storage     TEXT,
  estimated_farm_income    NUMERIC(12,2),
  notes                    TEXT,
  created_by_agent_id      UUID REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.produce_deliveries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id          UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  cooperative_id     UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  crop               TEXT NOT NULL,
  quantity_kg        NUMERIC(10,2) NOT NULL,
  quality_grade      TEXT CHECK (quality_grade IN ('A','B','C','D')),
  price_per_kg       NUMERIC(10,2),
  total_value        NUMERIC(12,2),
  date_delivered     DATE DEFAULT CURRENT_DATE,
  buyer_name         TEXT,                  -- buyer / offtaker
  warehouse          TEXT,
  receipt_number     TEXT,
  proof_photo_urls   TEXT[],
  delivery_status    TEXT DEFAULT 'recorded',
  payment_status     payment_status DEFAULT 'pending',
  logged_by_agent_id UUID REFERENCES auth.users(id),
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Market access / offtake history (Market-access tab)
CREATE TABLE IF NOT EXISTS public.market_access_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id          UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  season_year        INTEGER,
  buyer_name         TEXT,
  price_per_ton      NUMERIC(12,2),
  -- pricing context: 'distress' | 'market' | 'confirmed' | 'pre_agreed'
  price_context      TEXT,
  is_confirmed       BOOLEAN DEFAULT false,
  harvest_window     TEXT,
  notes              TEXT,
  created_by_agent_id UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Field notes / timeline (Field-notes tab)
CREATE TABLE IF NOT EXISTS public.field_notes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id          UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  cooperative_id     UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  -- 'assessment' | 'disbursement' | 'repayment' | 'registration' | 'visit' | 'general'
  note_type          TEXT DEFAULT 'general',
  title              TEXT,
  body               TEXT,
  tag_label          TEXT,
  -- visual variant for the tag pill: 'green' | 'amber' | 'neutral'
  tag_variant        TEXT DEFAULT 'green',
  event_date         TIMESTAMPTZ DEFAULT now(),
  created_by_agent_id UUID REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 5. FINANCING / REPAYMENTS  (manual payment flow is the active path)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.financing_requests (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id               UUID REFERENCES public.cooperatives(id) ON DELETE CASCADE NOT NULL,
  farmer_id                    UUID REFERENCES public.farmers(id) ON DELETE SET NULL,
  cycle_number                 INTEGER DEFAULT 1,
  loan_amount                  NUMERIC(12,2) NOT NULL,
  purpose                      TEXT,
  season                       TEXT,
  repayment_window_days        INTEGER DEFAULT 180,
  status                       financing_status DEFAULT 'pending',
  admin_comments               TEXT,
  rejection_reason             TEXT,
  -- admin matches the request to a partner; partner decides; admin acts on it
  forwarded_to_partner_id      UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  forwarded_at                 TIMESTAMPTZ,
  partner_decision             financing_status,
  partner_decision_at          TIMESTAMPTZ,
  partner_comments             TEXT,
  approved_amount              NUMERIC(12,2),
  -- manual disbursement details + proof (from 006)
  disbursed_amount             NUMERIC(12,2),
  disbursed_at                 TIMESTAMPTZ,
  disbursement_account_details TEXT,
  disbursement_reference       TEXT,
  disbursement_proof_urls      TEXT[],
  total_repaid                 NUMERIC(12,2) DEFAULT 0,   -- cached; maintained by app
  due_date                     DATE,
  submitted_by_agent_id        UUID REFERENCES auth.users(id),
  reviewed_by_admin_id         UUID REFERENCES auth.users(id),
  created_at                   TIMESTAMPTZ DEFAULT now(),
  updated_at                   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.repayment_records (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financing_request_id UUID REFERENCES public.financing_requests(id) ON DELETE CASCADE NOT NULL,
  farmer_id            UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  amount_paid          NUMERIC(12,2) NOT NULL,
  payment_date         DATE DEFAULT CURRENT_DATE,
  payment_method       TEXT,
  reference_number     TEXT,
  proof_photo_url      TEXT,
  context_flag         TEXT,           -- weather | market | health | none
  context_notes        TEXT,
  -- void (correction) path — from 008
  voided               BOOLEAN NOT NULL DEFAULT false,
  voided_at            TIMESTAMPTZ,
  voided_by_admin_id   UUID REFERENCES auth.users(id),
  void_reason          TEXT,
  recorded_by_agent_id UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 6. CREDIT SCORING  (Yield 60 / Repayment 40)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.regional_benchmarks (
  id                                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop                               TEXT NOT NULL,
  state                              TEXT NOT NULL,
  lga                                TEXT,
  benchmark_yield_tonnes_per_hectare NUMERIC(10,2) NOT NULL,
  source                             TEXT,
  season                             TEXT,
  created_at                         TIMESTAMPTZ DEFAULT now(),
  updated_at                         TIMESTAMPTZ DEFAULT now(),
  UNIQUE (crop, state, lga, season)
);

CREATE TABLE IF NOT EXISTS public.credit_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id             UUID REFERENCES public.farmers(id) ON DELETE CASCADE UNIQUE,
  production_score      NUMERIC(5,2) DEFAULT 0,   -- yield component (scaled to /60 by engine)
  repayment_score       NUMERIC(5,2) DEFAULT 0,   -- repayment component (scaled to /40 by engine)
  repayment_rate_score  NUMERIC(5,2) DEFAULT 0,
  timeliness_score      NUMERIC(5,2) DEFAULT 0,
  default_history_score NUMERIC(5,2) DEFAULT 0,
  final_credit_score    NUMERIC(5,2) DEFAULT 0,
  credit_tier           credit_tier,
  cycle_count           INTEGER DEFAULT 0,
  is_first_cycle        BOOLEAN DEFAULT true,
  has_active_default    BOOLEAN DEFAULT false,
  -- recommended loan limit shown in the financing summary
  recommended_loan_min  NUMERIC(12,2),
  recommended_loan_max  NUMERIC(12,2),
  recommended_loan_reason TEXT,
  model_version         TEXT DEFAULT 'v1.0',
  last_calculated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cooperative_credit_scores (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id     UUID REFERENCES public.cooperatives(id) ON DELETE CASCADE UNIQUE,
  average_score      NUMERIC(5,2) DEFAULT 0,
  cooperative_tier   credit_tier,
  total_farmers      INTEGER DEFAULT 0,
  scored_farmers     INTEGER DEFAULT 0,
  tier_a_count       INTEGER DEFAULT 0,
  tier_b_count       INTEGER DEFAULT 0,
  tier_c_count       INTEGER DEFAULT 0,
  tier_d_count       INTEGER DEFAULT 0,
  last_calculated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credit_score_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id        UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  cooperative_id   UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  final_score      NUMERIC(5,2) NOT NULL,
  credit_tier      credit_tier,
  component_scores JSONB NOT NULL,
  trigger_reason   TEXT,
  model_version    TEXT DEFAULT 'v1.0',
  calculated_at    TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 7. WALLET / SETTLEMENTS  (kept ready; manual cash flow uses these tables too)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agent_wallets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance    NUMERIC(12,2) DEFAULT 0,
  status     wallet_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id            UUID REFERENCES public.agent_wallets(id) ON DELETE CASCADE,
  transaction_type     transaction_type NOT NULL,
  amount               NUMERIC(12,2) NOT NULL,
  reference            TEXT,
  description          TEXT,
  -- source: repayment | financing_disbursement | settlement | cash_purchase | disbursement
  source               TEXT,
  status               transaction_status DEFAULT 'pending',
  reference_number     TEXT,
  recipient_name       TEXT,
  payment_method       TEXT,
  receipt_image_url    TEXT,
  proof_image_urls     TEXT[],
  related_financing_id UUID REFERENCES public.financing_requests(id) ON DELETE SET NULL,
  related_repayment_id UUID REFERENCES public.repayment_records(id) ON DELETE SET NULL,
  related_farmer_id    UUID REFERENCES public.farmers(id) ON DELETE SET NULL,
  created_by_user_id   UUID REFERENCES auth.users(id),
  confirmed_by_admin_id UUID REFERENCES auth.users(id),
  confirmed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settlement_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  amount               NUMERIC(12,2) NOT NULL,
  bank_name            TEXT,
  account_number       TEXT,
  account_name         TEXT,
  status               settlement_status DEFAULT 'pending',
  admin_notes          TEXT,
  approved_by_admin_id UUID REFERENCES auth.users(id),
  approved_at          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 8. NOTIFICATIONS / ACTIVITY / IMPORTS / CHANGE REQUESTS / OTP
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT,
  metadata   JSONB,
  is_read    BOOLEAN DEFAULT false,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   UUID,
  metadata    JSONB,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_logs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename                 TEXT,
  total_rows               INTEGER DEFAULT 0,
  successful_rows          INTEGER DEFAULT 0,
  failed_rows              INTEGER DEFAULT 0,
  errors                   JSONB,
  imported_cooperative_ids UUID[],
  imported_farmer_ids      UUID[],
  -- 'import' (create) vs 'sync' (update existing) — Bulk Import vs Sync Data
  mode                     TEXT DEFAULT 'import',
  created_at               TIMESTAMPTZ DEFAULT now()
);

-- Pending Changes: field-agent edits that an admin must approve/reject.
CREATE TABLE IF NOT EXISTS public.change_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type         TEXT NOT NULL,        -- 'farmer' | 'cooperative' | 'farm_profile'
  entity_id           UUID,
  change_type         TEXT NOT NULL DEFAULT 'update',  -- 'create' | 'update' | 'delete'
  proposed_changes    JSONB NOT NULL,
  current_snapshot    JSONB,
  status              change_request_status DEFAULT 'pending',
  submitted_by_agent_id UUID REFERENCES auth.users(id),
  reviewed_by_admin_id  UUID REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ,
  review_notes        TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  code       TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN ('signup','password_reset','email_verify')),
  consumed   BOOLEAN DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 9. UPGRADE-SAFE COLUMN ADDITIONS
--    (no-ops on a fresh DB; bring an older DB up to date without data loss)
-- =============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_number TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS tax_id TEXT;

ALTER TABLE public.cooperatives
  ADD COLUMN IF NOT EXISTS primary_crop TEXT;

ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS bvn_verification_status verification_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bvn_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS member_since DATE;

ALTER TABLE public.farm_profiles
  ADD COLUMN IF NOT EXISTS gps_mapped BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS computed_area_acres NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS plot_count INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS water_source TEXT DEFAULT 'rain_fed';

ALTER TABLE public.seasonal_productions
  ADD COLUMN IF NOT EXISTS farm_size_acres NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS harvest_date DATE,
  ADD COLUMN IF NOT EXISTS harvest_photo_urls TEXT[],
  ADD COLUMN IF NOT EXISTS warehouse_receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS buyer_receipt_url TEXT,
  ADD COLUMN IF NOT EXISTS verification_status yield_verification_status DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_by_agent_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS verification_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS seed_type TEXT,
  ADD COLUMN IF NOT EXISTS fertilizer_used TEXT,
  ADD COLUMN IF NOT EXISTS herbicide_used BOOLEAN,
  ADD COLUMN IF NOT EXISTS post_harvest_storage TEXT,
  ADD COLUMN IF NOT EXISTS estimated_farm_income NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS created_by_agent_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
-- Generated columns (added only if missing). Wrapped so a fresh DB that already
-- has them via CREATE TABLE doesn't error and an older DB gets them.
DO $$ BEGIN
  ALTER TABLE public.seasonal_productions
    ADD COLUMN yield_variance_tonnes NUMERIC(12,2) GENERATED ALWAYS AS (
      COALESCE(actual_yield_tonnes,0) - COALESCE(expected_yield_tonnes,0)
    ) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.seasonal_productions
    ADD COLUMN yield_achievement_rate NUMERIC(7,4) GENERATED ALWAYS AS (
      CASE WHEN expected_yield_tonnes IS NOT NULL AND expected_yield_tonnes > 0
           THEN ROUND(actual_yield_tonnes / expected_yield_tonnes, 4) ELSE NULL END
    ) STORED;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

ALTER TABLE public.produce_deliveries
  ADD COLUMN IF NOT EXISTS buyer_name TEXT,
  ADD COLUMN IF NOT EXISTS warehouse TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'recorded',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE public.financing_requests
  ADD COLUMN IF NOT EXISTS cycle_number INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS forwarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disbursement_account_details TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_reference TEXT,
  ADD COLUMN IF NOT EXISTS disbursement_proof_urls TEXT[],
  ADD COLUMN IF NOT EXISTS total_repaid NUMERIC(12,2) DEFAULT 0;

ALTER TABLE public.repayment_records
  ADD COLUMN IF NOT EXISTS voided BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by_admin_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE public.credit_scores
  ADD COLUMN IF NOT EXISTS recommended_loan_min NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS recommended_loan_max NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS recommended_loan_reason TEXT;

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS related_farmer_id UUID REFERENCES public.farmers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_by_admin_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

ALTER TABLE public.import_logs
  ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'import';

-- =============================================================================
-- 10. INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_farmers_cooperative_id        ON public.farmers(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_farmers_created_by_agent_id    ON public.farmers(created_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_cooperatives_created_by_agent  ON public.cooperatives(created_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_farm_profiles_farmer           ON public.farm_profiles(farmer_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_productions_farmer    ON public.seasonal_productions(farmer_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_productions_verif     ON public.seasonal_productions(verification_status);
CREATE INDEX IF NOT EXISTS idx_deliveries_farmer_id           ON public.produce_deliveries(farmer_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_date                ON public.produce_deliveries(date_delivered DESC);
CREATE INDEX IF NOT EXISTS idx_market_access_farmer           ON public.market_access_records(farmer_id);
CREATE INDEX IF NOT EXISTS idx_field_notes_farmer             ON public.field_notes(farmer_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_financing_status               ON public.financing_requests(status);
CREATE INDEX IF NOT EXISTS idx_financing_cooperative          ON public.financing_requests(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_financing_partner              ON public.financing_requests(forwarded_to_partner_id);
CREATE INDEX IF NOT EXISTS idx_repayments_financing           ON public.repayment_records(financing_request_id);
CREATE INDEX IF NOT EXISTS idx_repayment_records_active       ON public.repayment_records(financing_request_id) WHERE voided = false;
CREATE INDEX IF NOT EXISTS idx_wallet_tx_source               ON public.wallet_transactions(source, status);
CREATE INDEX IF NOT EXISTS idx_change_requests_status         ON public.change_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user             ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor            ON public.activity_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_score_history_farmer    ON public.credit_score_history(farmer_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_purpose        ON public.otp_codes(email, purpose, consumed);

-- =============================================================================
-- 11. HELPER FUNCTIONS + TRIGGERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','ops_admin','finance_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_partner(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('partner_admin','partner_analyst')
  )
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email), NEW.email)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data ->> 'role')::app_role, 'field_agent'))
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers (loop over the tables that have an updated_at column)
DO $$
DECLARE t TEXT;
  ts TEXT[] := ARRAY[
    'profiles','cooperatives','farmers','partners','financing_requests',
    'agent_applications','farm_profiles','seasonal_productions','produce_deliveries',
    'market_access_records','change_requests'
  ];
BEGIN
  FOREACH t IN ARRAY ts LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON public.%I;', t, t);
    EXECUTE format(
      'CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();',
      t, t
    );
  END LOOP;
END $$;

-- =============================================================================
-- 12. ROW LEVEL SECURITY + GRANTS
-- -----------------------------------------------------------------------------
-- The Node backend uses the SERVICE ROLE KEY and bypasses RLS. These policies
-- are defense-in-depth for any future anon/authenticated Supabase client.
-- =============================================================================
DO $$
DECLARE t TEXT;
  all_tables TEXT[] := ARRAY[
    'user_roles','profiles','agent_applications','partners','cooperatives','farmers',
    'farm_profiles','seasonal_productions','produce_deliveries','market_access_records',
    'field_notes','financing_requests','repayment_records','regional_benchmarks',
    'credit_scores','cooperative_credit_scores','credit_score_history','agent_wallets',
    'wallet_transactions','settlement_requests','notifications','activity_logs',
    'import_logs','change_requests','otp_codes'
  ];
BEGIN
  FOREACH t IN ARRAY all_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- user_roles
DROP POLICY IF EXISTS user_roles_self_view ON public.user_roles;
CREATE POLICY user_roles_self_view ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- profiles
DROP POLICY IF EXISTS profiles_self_view ON public.profiles;
CREATE POLICY profiles_self_view ON public.profiles
  FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- agent_applications
DROP POLICY IF EXISTS agent_apps_self ON public.agent_applications;
CREATE POLICY agent_apps_self ON public.agent_applications
  FOR ALL USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

-- partners
DROP POLICY IF EXISTS partners_admin_all ON public.partners;
CREATE POLICY partners_admin_all ON public.partners
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS partners_self_view ON public.partners;
CREATE POLICY partners_self_view ON public.partners
  FOR SELECT USING (id IN (SELECT partner_id FROM public.user_roles WHERE user_id = auth.uid()));

-- cooperatives
DROP POLICY IF EXISTS coop_admin_all ON public.cooperatives;
CREATE POLICY coop_admin_all ON public.cooperatives
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS coop_agent_own ON public.cooperatives;
CREATE POLICY coop_agent_own ON public.cooperatives
  FOR ALL USING (created_by_agent_id = auth.uid()) WITH CHECK (created_by_agent_id = auth.uid());
DROP POLICY IF EXISTS coop_partner_read ON public.cooperatives;
CREATE POLICY coop_partner_read ON public.cooperatives
  FOR SELECT USING (public.is_partner(auth.uid()));

-- farmers
DROP POLICY IF EXISTS farmers_admin_all ON public.farmers;
CREATE POLICY farmers_admin_all ON public.farmers
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
DROP POLICY IF EXISTS farmers_agent_own ON public.farmers;
CREATE POLICY farmers_agent_own ON public.farmers
  FOR ALL USING (created_by_agent_id = auth.uid()) WITH CHECK (created_by_agent_id = auth.uid());
DROP POLICY IF EXISTS farmers_partner_read ON public.farmers;
CREATE POLICY farmers_partner_read ON public.farmers
  FOR SELECT USING (public.is_partner(auth.uid()));

-- admin-all + partner-read pattern for the farmer-data tables
DO $$
DECLARE t TEXT;
  tables TEXT[] := ARRAY[
    'farm_profiles','seasonal_productions','produce_deliveries','market_access_records',
    'field_notes','financing_requests','repayment_records','credit_scores',
    'cooperative_credit_scores','credit_score_history'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_all ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY %I_admin_all ON public.%I FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_partner_read ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY %I_partner_read ON public.%I FOR SELECT USING (public.is_partner(auth.uid()));', t, t);
  END LOOP;
END $$;

-- benchmarks: authenticated read; admin write
DROP POLICY IF EXISTS benchmarks_read ON public.regional_benchmarks;
CREATE POLICY benchmarks_read ON public.regional_benchmarks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS benchmarks_admin_write ON public.regional_benchmarks;
CREATE POLICY benchmarks_admin_write ON public.regional_benchmarks
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- wallets / settlements / notifications / activity / imports
DROP POLICY IF EXISTS wallets_self ON public.agent_wallets;
CREATE POLICY wallets_self ON public.agent_wallets
  FOR ALL USING (agent_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (agent_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS wallet_tx_admin ON public.wallet_transactions;
CREATE POLICY wallet_tx_admin ON public.wallet_transactions
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS settlements_self ON public.settlement_requests;
CREATE POLICY settlements_self ON public.settlement_requests
  FOR ALL USING (agent_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (agent_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS notif_self ON public.notifications;
CREATE POLICY notif_self ON public.notifications
  FOR ALL USING (user_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS activity_admin ON public.activity_logs;
CREATE POLICY activity_admin ON public.activity_logs
  FOR ALL USING (actor_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (actor_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS imports_self ON public.import_logs;
CREATE POLICY imports_self ON public.import_logs
  FOR ALL USING (agent_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (agent_id = auth.uid() OR public.is_admin(auth.uid()));

-- change_requests: agents manage their own, admins see/decide all
DROP POLICY IF EXISTS change_requests_agent_own ON public.change_requests;
CREATE POLICY change_requests_agent_own ON public.change_requests
  FOR ALL USING (submitted_by_agent_id = auth.uid() OR public.is_admin(auth.uid()))
  WITH CHECK (submitted_by_agent_id = auth.uid() OR public.is_admin(auth.uid()));

-- otp_codes: end-users blocked; service_role allowed (from 001)
DROP POLICY IF EXISTS otp_block        ON public.otp_codes;
DROP POLICY IF EXISTS otp_deny_anon    ON public.otp_codes;
DROP POLICY IF EXISTS otp_service_role ON public.otp_codes;
CREATE POLICY otp_deny_anon ON public.otp_codes
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY otp_service_role ON public.otp_codes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants (from 002): privilege layer must permit ops before RLS evaluates.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role, authenticated;

-- =============================================================================
-- 13. STORAGE BUCKETS (from 007)
-- =============================================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('agent-documents',      'agent-documents',      false),
  ('farmer-documents',     'farmer-documents',     false),
  ('delivery-proofs',      'delivery-proofs',      true),
  ('transaction-receipts', 'transaction-receipts', true),
  ('partner-logos',        'partner-logos',        true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Storage object policies.
-- NOTE: the backend uploads via the service_role key, which BYPASSES RLS, so
-- these policies are not strictly required for the server. They are added so
-- that (a) public buckets are world-readable for <img> tags, and (b) any
-- authenticated client/context can still manage objects in the app buckets —
-- making uploads resilient even if a request is ever evaluated as
-- "authenticated" rather than "service_role".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public read partner-logos') THEN
    DROP POLICY "Public read partner-logos" ON storage.objects;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='heabron_public_read') THEN
    CREATE POLICY "heabron_public_read" ON storage.objects FOR SELECT
      USING (bucket_id IN ('delivery-proofs','transaction-receipts','partner-logos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='heabron_auth_read') THEN
    CREATE POLICY "heabron_auth_read" ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id IN ('agent-documents','farmer-documents','delivery-proofs','transaction-receipts','partner-logos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='heabron_auth_insert') THEN
    CREATE POLICY "heabron_auth_insert" ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id IN ('agent-documents','farmer-documents','delivery-proofs','transaction-receipts','partner-logos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='heabron_auth_update') THEN
    CREATE POLICY "heabron_auth_update" ON storage.objects FOR UPDATE TO authenticated
      USING (bucket_id IN ('agent-documents','farmer-documents','delivery-proofs','transaction-receipts','partner-logos'))
      WITH CHECK (bucket_id IN ('agent-documents','farmer-documents','delivery-proofs','transaction-receipts','partner-logos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='heabron_auth_delete') THEN
    CREATE POLICY "heabron_auth_delete" ON storage.objects FOR DELETE TO authenticated
      USING (bucket_id IN ('agent-documents','farmer-documents','delivery-proofs','transaction-receipts','partner-logos'));
  END IF;
END $$;

-- =============================================================================
-- 14. SEED DATA + BACKFILLS
-- =============================================================================
INSERT INTO public.regional_benchmarks (crop, state, lga, benchmark_yield_tonnes_per_hectare, source, season)
VALUES
  ('maize','default',NULL,2.0,'extension','wet'),
  ('rice','default',NULL,4.0,'extension','wet'),
  ('cassava','default',NULL,18.0,'extension','wet'),
  ('yam','default',NULL,12.0,'extension','wet'),
  ('beans','default',NULL,1.2,'extension','wet'),
  ('sorghum','default',NULL,1.5,'extension','wet'),
  ('millet','default',NULL,1.0,'extension','wet'),
  ('groundnut','default',NULL,1.5,'extension','wet'),
  ('soybean','default',NULL,1.8,'extension','wet'),
  ('cocoa','default',NULL,0.5,'extension','wet')
ON CONFLICT (crop, state, lga, season) DO NOTHING;

-- Backfill (from 003): only affects pre-existing rows; no-op on a fresh DB.
UPDATE public.cooperatives
  SET cooperative_tier = COALESCE(cooperative_tier,'D'),
      average_credit_score = COALESCE(average_credit_score,0)
  WHERE cooperative_tier IS NULL OR average_credit_score IS NULL;

INSERT INTO public.cooperative_credit_scores
  (cooperative_id, average_score, cooperative_tier, total_farmers, scored_farmers,
   tier_a_count, tier_b_count, tier_c_count, tier_d_count, last_calculated_at)
SELECT c.id, 0, 'D', 0, 0, 0, 0, 0, 0, now()
FROM public.cooperatives c
WHERE NOT EXISTS (
  SELECT 1 FROM public.cooperative_credit_scores ccs WHERE ccs.cooperative_id = c.id
);

UPDATE public.cooperatives c
  SET total_members = sub.cnt
  FROM (SELECT cooperative_id, COUNT(*)::int AS cnt FROM public.farmers GROUP BY cooperative_id) sub
  WHERE c.id = sub.cooperative_id AND c.total_members IS DISTINCT FROM sub.cnt;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
