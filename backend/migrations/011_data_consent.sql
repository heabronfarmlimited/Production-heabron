-- =============================================================================
-- 011_data_consent.sql
-- -----------------------------------------------------------------------------
-- Digital proof of consent, collected before any cooperative or farmer data is
-- captured. Implements "CoopScore Data Consent Specification" v1.0.
--
-- Two layers, both mandatory gates:
--   Flow A  cooperative consent, given once by the leader at registration
--   Flow B  farmer acknowledgment, given by each farmer during onboarding
--
-- DIFFERENCE FROM THE SPECIFICATION: the spec verifies the signer with an SMS
-- one-time code. There is no SMS provider on this platform and none was agreed,
-- so verification uses EMAIL through Resend, reusing the OTP table, templates
-- and rate limiting already built for signup. Where a signer has no email
-- address the record is saved `pending_verification`, exactly as the spec
-- already defines for the offline case, and an admin verifies out of band.
--
-- Consent records are IMMUTABLE. A change writes a new row and marks the
-- previous one `superseded`; nothing is updated in place except the withdrawal
-- and verification columns.
--
-- Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.consent_entity_type AS ENUM ('cooperative', 'farmer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.consent_status AS ENUM (
    'active',
    'pending_verification',
    'withdrawn',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.consent_otp_status AS ENUM ('verified', 'pending', 'failed', 'not_required');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- consent_records
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_records (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  entity_type            public.consent_entity_type NOT NULL,
  -- Not a foreign key: a farmer's consent is captured BEFORE the farmer row
  -- exists (the spec makes consent a gate on submission), so the reference is
  -- resolved by the application once the record is created.
  entity_id              UUID,

  agreement_version      TEXT NOT NULL DEFAULT 'v1.0',
  language               TEXT NOT NULL DEFAULT 'en',

  -- C1..C4 for a cooperative, F1..F3 for a farmer, each true/false.
  -- Stored as JSONB so a new agreement version can add items without a
  -- migration, while `agreement_version` records which set applied.
  item_responses         JSONB NOT NULL,

  -- Denormalised from item_responses so the sharing gate is a cheap indexed
  -- read rather than a JSON lookup on every partner query.
  third_party_sharing    BOOLEAN NOT NULL DEFAULT false,

  signer_name            TEXT NOT NULL,
  signer_role            TEXT,
  signer_phone           TEXT,
  signer_email           TEXT,

  -- Second cooperative officer (configurable, default on). Farmer flow unused.
  second_officer_name    TEXT,
  second_officer_phone   TEXT,
  second_officer_email   TEXT,

  -- Storage paths in the private `consent-evidence` bucket.
  signature_file         TEXT,
  voice_file             TEXT,
  -- Set when the signer could not sign and a thumbprint photo was taken.
  unable_to_sign         BOOLEAN NOT NULL DEFAULT false,

  otp_status             public.consent_otp_status NOT NULL DEFAULT 'pending',
  otp_verified_at        TIMESTAMPTZ,

  agent_id               UUID REFERENCES auth.users(id),

  -- Both kept: the device clock is what the agent saw, the server clock is
  -- what can be trusted. They diverge on an offline device.
  timestamp_device       TIMESTAMPTZ,
  timestamp_server       TIMESTAMPTZ NOT NULL DEFAULT now(),

  gps_latitude           NUMERIC(10, 7),
  gps_longitude          NUMERIC(10, 7),

  status                 public.consent_status NOT NULL DEFAULT 'pending_verification',

  withdrawal_date        TIMESTAMPTZ,
  withdrawal_reason      TEXT,
  withdrawn_by_user_id   UUID REFERENCES auth.users(id),

  -- Chain for the immutability rule: a replacement points at what it replaced.
  supersedes_id          UUID REFERENCES public.consent_records(id),

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_entity
  ON public.consent_records (entity_type, entity_id);

-- The hot path: "does this entity have a live consent record?"
CREATE INDEX IF NOT EXISTS idx_consent_active
  ON public.consent_records (entity_type, entity_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_consent_agent
  ON public.consent_records (agent_id, created_at DESC);

-- Pending OTP verification, which the admin dashboard lists.
CREATE INDEX IF NOT EXISTS idx_consent_pending
  ON public.consent_records (created_at DESC)
  WHERE status = 'pending_verification';

-- At most one live consent per entity. A replacement must mark the previous
-- row `superseded` in the same transaction, which is what makes the history
-- append-only rather than merely conventional.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consent_one_active
  ON public.consent_records (entity_type, entity_id)
  WHERE status = 'active';

-- -----------------------------------------------------------------------------
-- Gate flags on the entities themselves
-- -----------------------------------------------------------------------------
-- Denormalised for the same reason as third_party_sharing: every partner-facing
-- query needs to know whether sharing is permitted, and that must not depend on
-- the caller remembering to join consent_records.
ALTER TABLE public.cooperatives
  ADD COLUMN IF NOT EXISTS consent_record_id     UUID REFERENCES public.consent_records(id),
  ADD COLUMN IF NOT EXISTS consent_status        public.consent_status,
  ADD COLUMN IF NOT EXISTS third_party_sharing   BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.farmers
  ADD COLUMN IF NOT EXISTS consent_record_id     UUID REFERENCES public.consent_records(id),
  ADD COLUMN IF NOT EXISTS consent_status        public.consent_status,
  ADD COLUMN IF NOT EXISTS third_party_sharing   BOOLEAN NOT NULL DEFAULT false;

-- -----------------------------------------------------------------------------
-- Storage bucket for signature images and voice recordings
-- -----------------------------------------------------------------------------
-- Private. These are biometric-adjacent personal data: only admins may view
-- them, and partners see consent STATUS only, never the evidence itself.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('consent-evidence', 'consent-evidence', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- -----------------------------------------------------------------------------
-- Notification types for the consent lifecycle
-- -----------------------------------------------------------------------------
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'consent_pending_verification';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'consent_withdrawn';

-- -----------------------------------------------------------------------------
-- Allow consent one-time codes
-- -----------------------------------------------------------------------------
-- `otp_codes.purpose` is constrained to the auth purposes. Consent
-- verification reuses the same table and the same service, so the constraint
-- has to admit it — otherwise every consent OTP insert fails the CHECK and the
-- signer can never be verified.
ALTER TABLE public.otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE public.otp_codes
  ADD CONSTRAINT otp_codes_purpose_check
  CHECK (purpose IN ('signup', 'password_reset', 'email_verify', 'consent'));
