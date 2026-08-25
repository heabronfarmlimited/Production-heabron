# Migrations

This folder contains a SINGLE consolidated, idempotent migration:

  000_heabron_system_schema.sql

It replaces all previous migration files (the old 000–009 and the scattered
`migration */` folders). Run it once in the Supabase SQL Editor
(New query → paste → Run). It is safe on a fresh database, safe to re-run, and
safe to run on top of an older schema (CREATE ... IF NOT EXISTS +
ADD COLUMN IF NOT EXISTS).

Tested on Postgres 16 with the Supabase auth/storage/role environment:
fresh install, re-run, and upgrade-on-top-of-old-schema all complete with no
errors.
