-- =============================================================================
-- 003_backfill_cooperative_tiers.sql
-- -----------------------------------------------------------------------------
-- Backfills missing tier/score for cooperatives that were created before the
-- "seed on create" patch landed. Also refreshes total_members across the
-- board. Safe to re-run.
-- =============================================================================

-- 1. Backfill missing tier / score on cooperatives
UPDATE public.cooperatives
SET    cooperative_tier      = COALESCE(cooperative_tier, 'D'),
       average_credit_score  = COALESCE(average_credit_score, 0)
WHERE  cooperative_tier IS NULL
   OR  average_credit_score IS NULL;

-- 2. Seed missing aggregate-score rows
INSERT INTO public.cooperative_credit_scores
  (cooperative_id, average_score, cooperative_tier, total_farmers, scored_farmers,
   tier_a_count, tier_b_count, tier_c_count, tier_d_count, last_calculated_at)
SELECT c.id, 0, 'D', 0, 0, 0, 0, 0, 0, now()
FROM   public.cooperatives c
WHERE  NOT EXISTS (
         SELECT 1 FROM public.cooperative_credit_scores ccs WHERE ccs.cooperative_id = c.id
       );

-- 3. Refresh total_members based on actual farmer counts
UPDATE public.cooperatives c
SET    total_members = sub.cnt
FROM (
  SELECT cooperative_id, COUNT(*)::int AS cnt
  FROM   public.farmers
  GROUP  BY cooperative_id
) sub
WHERE c.id = sub.cooperative_id
  AND c.total_members IS DISTINCT FROM sub.cnt;

UPDATE public.cooperatives
SET    total_members = 0
WHERE  total_members > 0
  AND  id NOT IN (SELECT DISTINCT cooperative_id FROM public.farmers WHERE cooperative_id IS NOT NULL);
