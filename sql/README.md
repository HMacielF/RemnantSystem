# SQL

This folder tracks repo-side SQL for the current Supabase database structure.

## Files

- `public_schema_snapshot.sql`
  Compact reference snapshot of the live `public` schema, including tables, indexes, triggers, and RLS enablement.
- `approve_hold_request.sql`
  Standalone definition for the `public.approve_hold_request(...)` function.
- `auth_profile_bootstrap.sql`
  Auth trigger bootstrap that creates and backfills `public.profiles` rows from `auth.users`.
- `fresh_schema_bootstrap.sql`
  Bootstrap SQL for a fresh project, including app policies and helper views/functions.
- `msi_pricing_bootstrap.sql`
  Pricing tables, RLS, and views for protected supplier pricing plus abstract tier codes.
- `remnant_slab_normalization.sql`
  Additive migration that normalizes shared stone metadata across slabs and remnants.
- `reset_public_data.sql`
  Operational reset script for clearing app data in `public` when starting over.

## Notes

- This snapshot is intended as a readable source-of-truth reference, not a byte-for-byte `pg_dump`.
- Seed data, auth config, storage buckets, and Edge Functions are intentionally excluded.
- When the live database changes, refresh these files from Supabase so the repo stays aligned.
