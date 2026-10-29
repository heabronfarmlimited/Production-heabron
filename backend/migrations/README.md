# Migrations

## Fresh database

Run **`000_heabron_system_schema.sql`** once in the Supabase SQL Editor
(New query → paste → Run).

It is the single consolidated schema: every enum, table, index, RLS policy,
trigger, grant, storage bucket and seed row the API needs. It is idempotent
(`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`ADD VALUE IF NOT EXISTS`), so it is safe on a new database, safe to re-run, and
safe to run on top of an older schema.

That is the only file you need for a new environment. `010` below is already
included in it.

## Existing database

Apply anything numbered above the last file you ran. Right now that is:

* **`010_settlement_rejected_notification.sql`** — adds the
  `settlement_rejected` value to the `notification_type` enum. Until it runs, an
  agent whose cash-out is refused is never notified: the insert fails the enum
  check, the failure is caught and logged, and the rejection itself still
  succeeds. Safe to apply at any time and **not a deploy blocker**.

  Postgres requires `ALTER TYPE ... ADD VALUE` to run outside a transaction
  block, so run it in the SQL Editor, which executes statements individually.

## `legacy/`

The superseded per-change migrations (`000_initial_schema.sql` and `001`–`009`).
They are kept as the record of what was applied to the existing database, and
should **not** be run on a new one — `000_heabron_system_schema.sql` already
contains all of them.

They were moved here because the folder previously held two different files
both numbered `000` (`000_initial_schema.sql` and
`000_heabron_system_schema.sql`), which left the starting point ambiguous, plus
five duplicate snapshot directories (`migration 3`, `migration c`,
`migration new 2`, `migration new correction`, `migrations 4`) from repeated
downloads. Those directories have been removed. Before removing them, every
file inside was checked against its top-level counterpart: all were byte
identical except `007_storage_buckets.sql`, whose SQL was identical and whose
comments differed only in that the copy contradicted itself about whether two
buckets were public.

## A note on storage buckets

The `public` flag in the schema's `storage.buckets` insert must stay in step
with `isPublic` in the `BUCKETS` map in
`src/controllers/uploads.controller.js`, because that map decides whether the
API hands back a permanent public URL or an expiring signed one. A mismatch
fails quietly in both directions — a private bucket marked public leaks, and a
public bucket treated as private yields an expiring link to a file that is
readable anyway.

`npm test` enforces this: the check *"storage: every bucket the code writes to
is created by the schema"* asserts that every bucket an upload kind targets
exists and that its public flag matches.
