# Remnant System

Single-page web app and scraper pipeline for countertop remnants backed by Supabase.

## Current Architecture

- Public viewer: `public/index.html`
- Management UI: `private.html`
- Frontend logic: `public/main.js`
- API routes: `api/remnants.js`
- Scraper package:
  - `scraper/sync_remnants.py`
  - `scraper/config.py`
  - `scraper/parsing.py`
  - `scraper/utils.py`
  - `scraper/selenium_utils.py`

## Database Model

The app expects the Supabase schema to include:

- `public.companies`
- `public.materials`
- `public.thicknesses`
- `public.profiles`
- `public.remnants`

Key `public.remnants` columns used by this repo:

- `id bigint generated always as identity primary key`
- `moraware_remnant_id bigint unique`
- `company_id bigint not null`
- `material_id bigint not null`
- `thickness_id bigint not null`
- `name text not null`
- `width bigint not null`
- `height bigint not null`
- `l_shape boolean not null`
- `l_width bigint`
- `l_height bigint`
- `status text not null` with `available`, `hold`, `sold`
- `hash text not null`
- `image text`
- `image_path text`
- `photo_hash text`
- `photo_synced_at timestamptz`
- `source_image_url text`
- `last_seen_at timestamptz`
- `deleted_at timestamptz`

## Frontend Behavior

The viewer and management UI now use lookup-table IDs instead of free-text material and thickness fields.

`GET /api/remnants` returns active rows from `public.remnants`:

- `deleted_at is null`
- ordered by `id desc`
- joined with `companies`, `materials`, and `thicknesses`

Supported filter params:

- `material` (repeatable `material_id`)
- `stone`
- `min-width`
- `min-height`
- `status`

Extra API endpoints:

- `GET /api/lookups`
- `GET /api/me`

Management actions:

- status changes use `public.update_remnant_status(bigint, text)`
- archive/delete uses `public.soft_delete_remnant(bigint)`

## Local Development

### Node app

```bash
npm install
npm start
```

### Scraper

```bash
pip install -r requirements.txt
python -m scraper
```

Also supported:

```bash
python scraper/sync_remnants.py
python scraper/selenium_utils.py
```

## Environment Variables

See `.env.example` for a safe template.

### App/API

Required:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Optional:

- `SUPABASE_SERVICE_ROLE_KEY`
  used by the server for trusted public-read endpoints when your RLS only allows `authenticated`

### Scraper

Required:

- `MORAWARE_URL`
- `MORAWARE_USER`
- `MORAWARE_PASS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional:

- `SUPABASE_BUCKET`
  default: `remnant-images`
- `MORAWARE_PAGE_DELAY_SEC`
  default: `0.15`
- `MORAWARE_COMPANY_ID`
  use this when all synced Moraware remnants should belong to a specific existing company
- `MORAWARE_COMPANY_NAME`
  fallback company name when `MORAWARE_COMPANY_ID` is not set
  default: `Quick Countertop`
- `MORAWARE_HEADLESS`
  default: `true`

## Scraper Sync Rules

The scraper no longer depends on custom SQL RPCs like `sync_remnant(...)` or `reconcile_deletions(...)`.

Instead it:

- parses Moraware remnant rows
- resolves or creates `materials` and `thicknesses`
- resolves the target `company_id`
- inserts or updates `public.remnants` by `moraware_remnant_id`
- refreshes `last_seen_at`
- uploads photos to Supabase Storage
- soft-deletes stale Moraware rows by setting `deleted_at`

Important behavior:

- the Supabase row primary key `remnants.id` is internal to your app
- the Moraware identifier is stored in `remnants.moraware_remnant_id`
- manual app-created remnants can coexist with synced Moraware rows
- stale-row reconciliation only targets rows with a non-null `moraware_remnant_id`

## GitHub Cron

Cron workflow file:

- `.github/workflows/remnants-cron.yml`

Suggested secrets:

- `MORAWARE_URL`
- `MORAWARE_USER`
- `MORAWARE_PASS`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_BUCKET`
- `MORAWARE_COMPANY_ID` or `MORAWARE_COMPANY_NAME`

## Notes

- Last scraper issues report is written to `scraper/last_sync_issues.json`.
- The scraper uses the service role so it can resolve lookups and sync rows without being blocked by RLS.
- Status values in the app and database are lowercase: `available`, `hold`, `sold`.
