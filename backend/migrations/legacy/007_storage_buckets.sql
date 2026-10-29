-- =============================================================================
-- 007_storage_buckets.sql
-- -----------------------------------------------------------------------------
-- Creates every storage bucket the API uploads to.
-- "row violates row-level security policy" or 500/Bucket-not-found on uploads
-- means the target bucket doesn't exist yet.
--
-- Buckets used by src/controllers/uploads.controller.js:
--   agent-documents       (private)  selfies, avatars  ← needed for /auth/uploads/avatar
--   farmer-documents      (private)  ids, photos, land-docs, farm-photos
--   delivery-proofs       (public)   delivery proofs
--   transaction-receipts  (public)   payment / disbursement proofs
--   partner-logos         (public)   partner + cooperative logos
--
-- delivery-proofs and transaction-receipts are PUBLIC so proof URLs never
-- expire (admin + agent must view them in history indefinitely). URLs use
-- random UUIDs with no PII in the path.
--
-- Safe to re-run (ON CONFLICT updates the public flag).
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('agent-documents',      'agent-documents',      false),
  ('farmer-documents',     'farmer-documents',     false),
  ('delivery-proofs',      'delivery-proofs',      true),
  ('transaction-receipts', 'transaction-receipts', true),
  ('partner-logos',        'partner-logos',        true)
on conflict (id) do update set public = excluded.public;

-- The backend writes/reads with the SERVICE ROLE which bypasses storage RLS,
-- so no per-bucket policies are required for the API. The policy below lets
-- the browser/anon client read public partner logos directly. Guarded by name.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'Public read partner-logos'
  ) then
    create policy "Public read partner-logos"
      on storage.objects for select
      using (bucket_id = 'partner-logos');
  end if;
end $$;
