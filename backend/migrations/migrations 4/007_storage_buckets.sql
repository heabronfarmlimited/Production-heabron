-- =============================================================================
-- 007_storage_buckets.sql
-- -----------------------------------------------------------------------------
-- Creates every storage bucket the API uploads to. The "new row violates
-- row-level security policy" error on uploads means the target bucket does
-- not exist yet (the service role can write to any bucket that EXISTS, but
-- cannot create rows in a bucket Supabase doesn't know about).
--
-- Buckets used by src/controllers/uploads.controller.js:
--   agent-documents       (private)  selfies, avatars
--   farmer-documents      (private)  ids, photos, land-docs, farm-photos
--   delivery-proofs       (private)
--   transaction-receipts  (private)  <-- the one your disbursement upload hit
--   partner-logos         (public)   partner + cooperative logos
--
-- Run this once in the Supabase SQL editor. Idempotent (ON CONFLICT DO NOTHING).
-- =============================================================================

insert into storage.buckets (id, name, public)
values
  ('agent-documents',      'agent-documents',      false),
  ('farmer-documents',     'farmer-documents',     false),
  ('delivery-proofs',      'delivery-proofs',      true),
  ('transaction-receipts', 'transaction-receipts', true),
  ('partner-logos',        'partner-logos',        true)
on conflict (id) do update set public = excluded.public;

-- transaction-receipts and delivery-proofs are PUBLIC so the proof image/PDF
-- URLs never expire (the admin and field agent must be able to view them in
-- history indefinitely). The URLs are long random UUIDs — not guessable —
-- and contain no PII in the path. If you prefer private buckets, set them to
-- false and the API will issue signed URLs instead (these expire; see note
-- in the disbursement upload section).

-- The backend writes/reads with the SERVICE ROLE, which bypasses storage RLS,
-- so no per-bucket policies are strictly required for the API to work.
-- If you ALSO want the browser/anon client to read public partner logos
-- directly, this read policy helps (safe to run; guarded by name):
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
