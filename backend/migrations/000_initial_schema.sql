-- =============================================================================
-- HEABRON COOPSCORE — CONSOLIDATED INITIAL SCHEMA
-- =============================================================================
-- Single migration file to be run on Supabase.
-- Creates all enums, tables, indexes, RLS policies, triggers, and seed data
-- for the Heabron CoopScore platform (Field Agents, Admins, Partners).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- EXTENSIONS
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUM TYPES
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('super_admin', 'ops_admin', 'finance_admin', 'field_agent', 'partner_admin', 'partner_analyst');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.user_status AS ENUM ('pending', 'active', 'suspended', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.gender_type AS ENUM ('male', 'female', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'mismatch', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.financing_status AS ENUM ('pending', 'approved', 'rejected', 'disbursed', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending', 'paid', 'overdue', 'defaulted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.credit_tier AS ENUM ('A', 'B', 'C', 'D');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.wallet_status AS ENUM ('active', 'frozen', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_type AS ENUM ('credit', 'debit', 'settlement');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.transaction_status AS ENUM ('pending', 'completed', 'failed', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_status AS ENUM ('pending', 'approved', 'rejected', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.notification_type AS ENUM (
    'agent_application_submitted','agent_approved','agent_rejected',
    'financing_request_submitted','financing_approved','financing_rejected','financing_disbursed',
    'repayment_recorded','delivery_logged','farmer_added','cooperative_added',
    'credit_score_updated','partner_invited','partner_password_reset',
    'settlement_requested','settlement_approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- USERS / ROLES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role        app_role NOT NULL DEFAULT 'field_agent',
  partner_id  UUID,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  avatar_url      TEXT,
  state           TEXT,
  lga             TEXT,
  status          user_status DEFAULT 'pending',
  must_change_password BOOLEAN DEFAULT false,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- FIELD AGENT APPLICATIONS / KYC
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone                 TEXT,
  nin                   TEXT,
  date_of_birth         DATE,
  state                 TEXT,
  lga                   TEXT,
  selfie_url            TEXT,
  nin_verification_status verification_status DEFAULT 'pending',
  nin_verification_payload JSONB,
  selfie_verified       BOOLEAN DEFAULT false,
  status                user_status DEFAULT 'pending',
  rejection_reason      TEXT,
  reviewed_by           UUID REFERENCES auth.users(id),
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PARTNERS (LENDERS / INVESTORS / ORGANIZATIONS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.partners (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name     TEXT NOT NULL,
  organization_email    TEXT NOT NULL UNIQUE,
  logo_url              TEXT,
  contact_phone         TEXT,
  address               TEXT,
  state                 TEXT,
  status                user_status DEFAULT 'active',
  created_by_admin_id   UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_roles
  ADD CONSTRAINT fk_user_roles_partner FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- COOPERATIVES / FARMERS / FARM PROFILES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cooperatives (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  registration_number   TEXT UNIQUE,
  leader_name           TEXT,
  leader_phone          TEXT,
  total_members         INTEGER DEFAULT 0,
  crops_supported       TEXT[],
  state                 TEXT,
  lga                   TEXT,
  address               TEXT,
  estimated_land_size   NUMERIC(10,2),
  logo_url              TEXT,
  gps_lat               NUMERIC(10,8),
  gps_lng               NUMERIC(11,8),
  gps_polygon           JSONB,
  cooperative_tier      credit_tier,
  average_credit_score  NUMERIC(5,2) DEFAULT 0,
  created_by_agent_id   UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farmers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id        UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  full_name             TEXT NOT NULL,
  date_of_birth         DATE,
  gender                gender_type,
  phone                 TEXT,
  alt_phone             TEXT,
  address               TEXT,
  state                 TEXT,
  lga                   TEXT,
  household_size        INTEGER DEFAULT 1,
  dependents            INTEGER DEFAULT 0,
  education_level       TEXT,
  nin                   TEXT,
  bvn                   TEXT,
  id_image_url          TEXT,
  farmer_photo_url      TEXT,
  nin_verification_status verification_status DEFAULT 'pending',
  nin_verification_payload JSONB,
  verified_at           TIMESTAMPTZ,
  verified_by_agent_id  UUID,
  credit_score          NUMERIC(5,2) DEFAULT 0,
  credit_tier           credit_tier,
  created_by_agent_id   UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.farm_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id           UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  farm_size_acres     NUMERIC(10,2),
  gps_lat             NUMERIC(10,8),
  gps_lng             NUMERIC(11,8),
  gps_polygon         JSONB,
  soil_type           TEXT,
  irrigation_access   BOOLEAN DEFAULT false,
  water_source        TEXT,
  crop_type           TEXT,
  secondary_crops     TEXT[],
  land_ownership      TEXT,
  years_experience    INTEGER DEFAULT 0,
  farm_photo_urls     TEXT[],
  land_document_url   TEXT,
  land_document_type  TEXT,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PRODUCTION / DELIVERIES / PAYMENTS / REPAYMENTS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seasonal_productions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id               UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  cycle_number            INTEGER DEFAULT 1,
  season                  TEXT, -- e.g. "wet_2026", "dry_2026"
  crop                    TEXT,
  expected_planting_date  DATE,
  expected_harvest_date   DATE,
  expected_yield_tonnes   NUMERIC(10,2),
  actual_yield_tonnes     NUMERIC(10,2),
  benchmark_yield_tonnes  NUMERIC(10,2),
  yield_ratio             NUMERIC(5,4),
  yield_verified_by_agent BOOLEAN DEFAULT false,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.produce_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id         UUID REFERENCES public.farmers(id) ON DELETE CASCADE NOT NULL,
  cooperative_id    UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  crop              TEXT NOT NULL,
  quantity_kg       NUMERIC(10,2) NOT NULL,
  quality_grade     TEXT CHECK (quality_grade IN ('A','B','C','D')),
  price_per_kg      NUMERIC(10,2),
  total_value       NUMERIC(12,2),
  date_delivered    DATE DEFAULT CURRENT_DATE,
  receipt_number    TEXT,
  proof_photo_urls  TEXT[],
  payment_status    payment_status DEFAULT 'pending',
  logged_by_agent_id UUID REFERENCES auth.users(id),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- FINANCING / LOANS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financing_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id        UUID REFERENCES public.cooperatives(id) ON DELETE CASCADE NOT NULL,
  farmer_id             UUID REFERENCES public.farmers(id) ON DELETE SET NULL,
  loan_amount           NUMERIC(12,2) NOT NULL,
  purpose               TEXT,
  season                TEXT,
  repayment_window_days INTEGER DEFAULT 180,
  status                financing_status DEFAULT 'pending',
  admin_comments        TEXT,
  rejection_reason      TEXT,
  forwarded_to_partner_id UUID REFERENCES public.partners(id) ON DELETE SET NULL,
  partner_decision      financing_status,
  partner_decision_at   TIMESTAMPTZ,
  partner_comments      TEXT,
  approved_amount       NUMERIC(12,2),
  disbursed_amount      NUMERIC(12,2),
  disbursed_at          TIMESTAMPTZ,
  due_date              DATE,
  submitted_by_agent_id UUID REFERENCES auth.users(id),
  reviewed_by_admin_id  UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.repayment_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financing_request_id UUID REFERENCES public.financing_requests(id) ON DELETE CASCADE NOT NULL,
  farmer_id           UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  amount_paid         NUMERIC(12,2) NOT NULL,
  payment_date        DATE DEFAULT CURRENT_DATE,
  payment_method      TEXT,
  reference_number    TEXT,
  proof_photo_url     TEXT,
  context_flag        TEXT, -- weather, market, health, none
  context_notes       TEXT,
  recorded_by_agent_id UUID REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- CREDIT SCORING
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.regional_benchmarks (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crop                        TEXT NOT NULL,
  state                       TEXT NOT NULL,
  lga                         TEXT,
  benchmark_yield_tonnes_per_hectare NUMERIC(10,2) NOT NULL,
  source                      TEXT, -- "extension","cooperative_history","blend"
  season                      TEXT,
  created_at                  TIMESTAMPTZ DEFAULT now(),
  updated_at                  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(crop, state, lga, season)
);

CREATE TABLE IF NOT EXISTS public.credit_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id             UUID REFERENCES public.farmers(id) ON DELETE CASCADE UNIQUE,
  production_score      NUMERIC(5,2) DEFAULT 0,
  repayment_score       NUMERIC(5,2) DEFAULT 0,
  repayment_rate_score  NUMERIC(5,2) DEFAULT 0,
  timeliness_score      NUMERIC(5,2) DEFAULT 0,
  default_history_score NUMERIC(5,2) DEFAULT 0,
  final_credit_score    NUMERIC(5,2) DEFAULT 0,
  credit_tier           credit_tier,
  cycle_count           INTEGER DEFAULT 0,
  is_first_cycle        BOOLEAN DEFAULT true,
  has_active_default    BOOLEAN DEFAULT false,
  model_version         TEXT DEFAULT 'v1.0',
  last_calculated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cooperative_credit_scores (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cooperative_id        UUID REFERENCES public.cooperatives(id) ON DELETE CASCADE UNIQUE,
  average_score         NUMERIC(5,2) DEFAULT 0,
  cooperative_tier      credit_tier,
  total_farmers         INTEGER DEFAULT 0,
  scored_farmers        INTEGER DEFAULT 0,
  tier_a_count          INTEGER DEFAULT 0,
  tier_b_count          INTEGER DEFAULT 0,
  tier_c_count          INTEGER DEFAULT 0,
  tier_d_count          INTEGER DEFAULT 0,
  last_calculated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credit_score_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  farmer_id       UUID REFERENCES public.farmers(id) ON DELETE CASCADE,
  cooperative_id  UUID REFERENCES public.cooperatives(id) ON DELETE SET NULL,
  final_score     NUMERIC(5,2) NOT NULL,
  credit_tier     credit_tier,
  component_scores JSONB NOT NULL,
  trigger_reason  TEXT,
  model_version   TEXT DEFAULT 'v1.0',
  calculated_at   TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- WALLETS / TRANSACTIONS (for field agents; non-active feature kept ready)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.agent_wallets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  balance     NUMERIC(12,2) DEFAULT 0,
  status      wallet_status DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id       UUID REFERENCES public.agent_wallets(id) ON DELETE CASCADE,
  transaction_type transaction_type NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  reference       TEXT,
  description     TEXT,
  source          TEXT, -- repayment, financing_disbursement, settlement
  status          transaction_status DEFAULT 'pending',
  reference_number TEXT,
  recipient_name  TEXT,
  payment_method  TEXT,
  receipt_image_url TEXT,
  proof_image_urls TEXT[],
  related_financing_id UUID REFERENCES public.financing_requests(id) ON DELETE SET NULL,
  related_repayment_id UUID REFERENCES public.repayment_records(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settlement_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2) NOT NULL,
  bank_name       TEXT,
  account_number  TEXT,
  account_name    TEXT,
  status          settlement_status DEFAULT 'pending',
  admin_notes     TEXT,
  approved_by_admin_id UUID REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- NOTIFICATIONS / ACTIVITY
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT,
  metadata    JSONB,
  is_read     BOOLEAN DEFAULT false,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT now()
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
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  filename            TEXT,
  total_rows          INTEGER DEFAULT 0,
  successful_rows     INTEGER DEFAULT 0,
  failed_rows         INTEGER DEFAULT 0,
  errors              JSONB,
  imported_cooperative_ids UUID[],
  imported_farmer_ids UUID[],
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- PASSWORD RESET TOKENS / OTPS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  purpose     TEXT NOT NULL CHECK (purpose IN ('signup','password_reset','email_verify')),
  consumed    BOOLEAN DEFAULT false,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_farmers_cooperative_id ON public.farmers(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_farmers_created_by_agent_id ON public.farmers(created_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_cooperatives_created_by_agent_id ON public.cooperatives(created_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_farmer_id ON public.produce_deliveries(farmer_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_date ON public.produce_deliveries(date_delivered DESC);
CREATE INDEX IF NOT EXISTS idx_financing_status ON public.financing_requests(status);
CREATE INDEX IF NOT EXISTS idx_financing_cooperative ON public.financing_requests(cooperative_id);
CREATE INDEX IF NOT EXISTS idx_repayments_financing ON public.repayment_records(financing_request_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor ON public.activity_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_score_history_farmer ON public.credit_score_history(farmer_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_purpose ON public.otp_codes(email, purpose, consumed);

-- -----------------------------------------------------------------------------
-- HELPER FUNCTIONS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin','ops_admin','finance_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_partner(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('partner_admin','partner_analyst')
  )
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Trigger: auto-create profile + default role on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data ->> 'role')::app_role, 'field_agent')
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_cooperatives_updated_at ON public.cooperatives;
CREATE TRIGGER update_cooperatives_updated_at BEFORE UPDATE ON public.cooperatives FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_farmers_updated_at ON public.farmers;
CREATE TRIGGER update_farmers_updated_at BEFORE UPDATE ON public.farmers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_partners_updated_at ON public.partners;
CREATE TRIGGER update_partners_updated_at BEFORE UPDATE ON public.partners FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_financing_updated_at ON public.financing_requests;
CREATE TRIGGER update_financing_updated_at BEFORE UPDATE ON public.financing_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_agent_applications_updated_at ON public.agent_applications;
CREATE TRIGGER update_agent_applications_updated_at BEFORE UPDATE ON public.agent_applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_farm_profiles_updated_at ON public.farm_profiles;
CREATE TRIGGER update_farm_profiles_updated_at BEFORE UPDATE ON public.farm_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooperatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasonal_productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produce_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repayment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regional_benchmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooperative_credit_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_codes ENABLE ROW LEVEL SECURITY;

-- Note: the Node.js backend uses the SERVICE ROLE KEY and bypasses RLS.
-- These policies exist as a defense-in-depth layer in case Supabase Auth or
-- anon clients are used in future.

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

-- partners (admins and partner users can view their own org)
DROP POLICY IF EXISTS partners_admin_all ON public.partners;
CREATE POLICY partners_admin_all ON public.partners
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS partners_self_view ON public.partners;
CREATE POLICY partners_self_view ON public.partners
  FOR SELECT USING (
    id IN (SELECT partner_id FROM public.user_roles WHERE user_id = auth.uid())
  );

-- cooperatives (admin all, agent own, partners read all forwarded)
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

-- farm_profiles, seasonal_productions, deliveries, financing, repayments, scores
-- (similar pattern: admin all, agent own farmers, partner read)
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'farm_profiles','seasonal_productions','produce_deliveries',
    'financing_requests','repayment_records','credit_scores',
    'cooperative_credit_scores','credit_score_history'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_admin_all ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_admin_all ON public.%I FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));',
      tbl, tbl
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_partner_read ON public.%I;', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY %I_partner_read ON public.%I FOR SELECT USING (public.is_partner(auth.uid()));',
      tbl, tbl
    );
  END LOOP;
END $$;

-- benchmarks: everyone authenticated reads; only admins write
DROP POLICY IF EXISTS benchmarks_read ON public.regional_benchmarks;
CREATE POLICY benchmarks_read ON public.regional_benchmarks FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS benchmarks_admin_write ON public.regional_benchmarks;
CREATE POLICY benchmarks_admin_write ON public.regional_benchmarks
  FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- wallets / settlement / notifications / activity logs / imports / otp
DROP POLICY IF EXISTS wallets_self ON public.agent_wallets;
CREATE POLICY wallets_self ON public.agent_wallets
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

-- otp_codes: backend service role only; no end-user access
DROP POLICY IF EXISTS otp_block ON public.otp_codes;
CREATE POLICY otp_block ON public.otp_codes FOR ALL USING (false) WITH CHECK (false);

-- -----------------------------------------------------------------------------
-- STORAGE BUCKETS (idempotent)
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('farmer-documents','farmer-documents',false),
  ('agent-documents','agent-documents',false),
  ('partner-logos','partner-logos',true),
  ('delivery-proofs','delivery-proofs',false),
  ('transaction-receipts','transaction-receipts',false)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- SEED DATA
-- -----------------------------------------------------------------------------
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

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================
