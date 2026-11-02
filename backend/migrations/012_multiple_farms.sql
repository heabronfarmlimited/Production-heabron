-- 012_multiple_farms.sql
--
-- Redesigned user flow: "Add Another Farm".
--
-- A farmer may hold several separate plots — often different crops, sometimes
-- in different LGAs — and the flow asks the agent to record each one. The
-- table already allowed it (`farm_profiles.farmer_id` has a plain index, not a
-- unique one), but nothing distinguished one row from another, so a farmer
-- with two farms showed two identical-looking cards and every read in the API
-- took `farm_profiles[0]` — an arbitrary row.
--
-- This migration adds the two columns that make a set of farms addressable:
--
--   farm_label  the agent's own name for the plot ("Cassava plot", "Behind
--               the river"). Optional; the API falls back to "Farm 1", "Farm
--               2" by creation order, which is why this is nullable rather
--               than defaulted — a generated default would freeze a number
--               that the display order can change.
--
--   is_primary  exactly one farm per farmer is the primary. It is the one the
--               single-farm screens show, the one a nested `farm` object in
--               PATCH /farmers/:id edits, and the one whose crop_type is
--               treated as the farmer's main crop. Land TOTALS always sum
--               every farm; primary is about which single row to display, not
--               which row counts.
--
-- Scoring note: the production score divides yield by (benchmark x land
-- size). Land size is now the SUM across a farmer's farms, so an existing
-- farmer who gains a second farm has a larger denominator and — correctly —
-- needs more output for the same score. Nothing is backfilled here: a farmer
-- with one farm sums to exactly what they had before, so no existing score
-- moves because of this migration.

ALTER TABLE public.farm_profiles
  ADD COLUMN IF NOT EXISTS farm_label TEXT,
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Every farmer that already has farms gets their oldest row marked primary.
-- Written to be re-runnable: it only touches farmers with no primary yet.
WITH first_farm AS (
  SELECT DISTINCT ON (farmer_id) id
    FROM public.farm_profiles
   ORDER BY farmer_id, created_at ASC, id ASC
)
UPDATE public.farm_profiles fp
   SET is_primary = true
  FROM first_farm ff
 WHERE fp.id = ff.id
   AND NOT EXISTS (
     SELECT 1 FROM public.farm_profiles other
      WHERE other.farmer_id = fp.farmer_id
        AND other.is_primary = true
   );

-- At most one primary per farmer. A partial unique index rather than a CHECK:
-- it has to hold across rows, and it lets the API promote a new primary by
-- clearing the old one first (two statements in one transaction) without a
-- deferrable constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uq_farm_profiles_one_primary
  ON public.farm_profiles(farmer_id)
  WHERE is_primary = true;

-- Reads are almost always "this farmer's farms, in display order".
CREATE INDEX IF NOT EXISTS idx_farm_profiles_farmer_order
  ON public.farm_profiles(farmer_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- Cooperative land size is derived, not entered.
--
-- The redesigned flow drops the question: "Do not show or ask for cooperative
-- land size... Land total is derived from eligible linked farmer farm
-- records." The column is NOT dropped — existing rows hold numbers an agent
-- typed, and dropping it would discard them irreversibly for no gain. Instead
-- it is marked deprecated and the API stops accepting and returning it; the
-- cooperative's land total is summed from member farms at read time.
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.cooperatives.estimated_land_size IS
  'DEPRECATED (v2 user flow). Agent-entered estimate, no longer collected or '
  'returned by the API. The cooperative land total is derived by summing '
  'farm_profiles.farm_size_acres across linked farmers. Retained read-only so '
  'historical estimates are not lost; do not write to it.';

COMMENT ON COLUMN public.farm_profiles.is_primary IS
  'Exactly one per farmer (uq_farm_profiles_one_primary). The farm shown on '
  'single-farm screens and edited by a nested `farm` object. Land totals sum '
  'all farms regardless of this flag.';

COMMENT ON COLUMN public.farm_profiles.farm_label IS
  'Agent-supplied name for this plot. NULL means the API labels it by '
  'position ("Farm 1", "Farm 2") in creation order.';
