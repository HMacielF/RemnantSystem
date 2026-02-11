# Remnant System

Single-page web app and scraper pipeline for Quick Countertop remnants.

## Current Architecture

- Frontend page: `public/index.html`
- Frontend logic: `public/main.js`
- Main API endpoint: `GET /api/remnants`
- API implementation: `api/remnants.js`
- Scraper package:
  - `scraper/sync_remnants.py` (main flow)
  - `scraper/config.py` (env/config)
  - `scraper/parsing.py` (line/title parsing)
  - `scraper/utils.py` (hashing, extension inference, sessions)
  - `scraper/selenium_utils.py` (backward-compatible entrypoint)

## Frontend Filters

The single page filters using query params sent to `/api/remnants`:

- `material` (repeatable)
- `stone`
- `min-width`
- `min-height`
- `status`

## Remnants API Behavior

`GET /api/remnants` returns rows from `public.remnants` with:

- `is_active = true`
- `deleted_at is null`
- ordered by `id desc`

The API applies optional filters for material, stone (`name`), width, height, and status.

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

## Required Environment Variables

### App/API

- `SUPABASE_URL`
- `SUPABASE_KEY`

### Scraper

- `MORAWARE_URL`
- `MORAWARE_USER`
- `MORAWARE_PASS`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `SUPABASE_BUCKET` (optional, default `remnant-images`)
- `MORAWARE_PAGE_DELAY_SEC` (optional, default `0.15`)

## GitHub Cron (Scraper)

Cron workflow file:

- `.github/workflows/remnants-cron.yml`

Required GitHub repository secrets:

- `MORAWARE_URL`
- `MORAWARE_USER`
- `MORAWARE_PASS`
- `SUPABASE_URL`
- `SUPABASE_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`)
- `SUPABASE_BUCKET` (optional)

## Required Supabase RPC Functions

The scraper expects these SQL functions to exist:

- `sync_remnant(...)`
- `reconcile_deletions(p_run_started_at timestamptz)`

`sync_remnant` must use the current table column names (`l_width`, `l_height`, etc.).

## Notes

- Last scraper issues report is written to `scraper/last_sync_issues.json`.
- The scraper currently performs soft-delete reconciliation via `is_active` and `deleted_at`.
