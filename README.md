# Remnant System

Next.js web app plus scraper pipeline for countertop remnants and slab catalogs, backed by Supabase.

## Project Layout

```text
.
├── public/               Shared static assets only
├── scrapers/             Unified scraper package
├── scripts/              Import and analysis helpers
├── sql/                  Schema, seed, and operational SQL
├── apps/web/             Next.js app routes and components
├── package.json          Root scripts and shared Node dependencies
└── requirements.txt      Python scraper dependencies
```

## Main App Surface

- Public viewer: `apps/web/src/app/page.js`
- Public slab catalog: `apps/web/src/app/slabs/page.js`
- Management UI: `apps/web/src/app/manage/page.js`
- Super admin UI: `apps/web/src/app/admin/page.js`
- Overview page: `apps/web/src/app/overview/page.js`
- Auth routes: `apps/web/src/app/portal/page.js`, `apps/web/src/app/forgot-password/page.js`, `apps/web/src/app/set-password/page.js`
- Public aliases: `apps/web/src/app/quick/page.js`, `apps/web/src/app/prime/page.js`
- Slab catalog client: `apps/web/src/components/slab-catalog-client.js`
- Next route handlers: `apps/web/src/app/api/*`
- Shared server helpers: `apps/web/src/server/*`
- Custom Next server: `apps/web/server.js`

There are no standalone app HTML pages left in the repo. The `public/` directory is only for static assets.

## Scraper Structure

All scraper code now lives under the `scrapers/` namespace:

- `scrapers/remnant_scraper/`
  Moraware remnant sync. This is the canonical package and the target of `python3 -m scrapers.remnant_scraper`.
- `scrapers/slab_scraper/`
  Supplier-specific slab catalog scrapers. Each supplier lives in its own module and exports JSON/CSV for import.

Common slab-catalog supporting files:

- Slab import script: `scripts/import_slab_catalog.js`
- Slab color analysis helper: `scripts/analyze_slab_colors.py`

## Database Model

The app expects the Supabase schema to include:

- `public.companies`
- `public.materials`
- `public.thicknesses`
- `public.profiles`
- `public.remnants`
- `public.holds`
- `public.hold_requests`
- `public.notification_queue`
- `public.audit_logs`
- `public.remnant_sales`
- `public.suppliers`
- `public.colors`
- `public.finishes`
- `public.slabs`
- `public.slab_colors`
- `public.slab_finishes`
- `public.slab_thicknesses`

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

The app now separates public and authenticated inventory APIs:

- public routes use `/api/public/*`
- authenticated management routes use `/api/*`
- public inventory reads from `public.active_remnants`
- management inventory reads from `public.remnants`
- both paths are enriched with current hold metadata
- management rows are also enriched with latest status actor / sale metadata

Supported filter params:

- `material`
- `stone`
- `min-width`
- `min-height`
- `status`

Core public API endpoints:

- `GET /api/public/lookups`
- `GET /api/public/remnants`
- `POST /api/public/remnants/enrichment`
- `GET /api/public/sales-reps`
- `GET /api/public/summary`
- `POST /api/public/hold-requests`

Core authenticated API endpoints:

- `GET /api/lookups`
- `GET /api/me`
- `GET /api/sales-reps`
- `GET /api/next-stone-id`
- `GET /api/slabs`
- `GET /api/remnants`
- `POST /api/remnants`
- `GET /api/remnants/summary`
- `POST /api/remnants/enrichment`
- `GET /api/hold-requests`
- `PATCH /api/hold-requests/:id`
- `PATCH /api/remnants/:id`
- `DELETE /api/remnants/:id`
- `GET /api/remnants/:id/hold`
- `POST /api/remnants/:id/hold`
- `POST /api/remnants/:id/status`
- `PATCH /api/remnants/:id/image`
- `POST /api/holds/:id/release`
- `GET /api/admin/db/meta`
- `GET|POST|PATCH|DELETE /api/admin/db/:table`

Management actions:

- status changes use `public.update_remnant_status(bigint, text)`
- archive/delete uses `public.soft_delete_remnant(bigint)`
- hold creation/renewal uses the dedicated `public.holds` table
- sales are recorded in `public.remnant_sales`

## Local Development

Recommended runtime:

- Node `24`
- Supported range for this repo: Node `24.x`

### Next.js web app

```bash
npm install
npm run web:dev
```

The root install also installs the `apps/web` dependencies through the root `postinstall` script.
Development now runs through the standard Next CLI in `webpack` mode for stability. If the dev cache ever gets corrupted, run `npm run web:dev:clean`. If you want to remove old stale cache folders too, use `npm run web:clean:deep`.

Useful companion commands:

```bash
npm run web:dev:clean
npm run web:clean
npm run web:clean:deep
npm run web:build
npm run web:lint
npm test
```

By default the app runs on `http://localhost:3001`.

### Vercel

Deploy the Next.js app from `apps/web`, not from the repo root.

- Framework preset: `Next.js`
- Root Directory: `apps/web`
- Node version: `24.x`

Environment variables to set in Vercel for the app:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` if you want trusted server-side public endpoints and admin flows to work

The root `package.json` is for local workspace orchestration. The actual deployable Next app lives in `apps/web/`.

### Moraware remnant scraper

Preferred entrypoint:

```bash
python3 -m scrapers.remnant_scraper
```

Direct entrypoint also supported:

```bash
python3 scrapers/remnant_scraper/sync_remnants.py
```

Also supported:

```bash
python3 scrapers/remnant_scraper/selenium_utils.py
```

### Supplier slab scrapers

Examples:

```bash
npm run scraper:vadara
npm run scraper:daltile
npm run scraper:raphael-stones
npm run scraper:reliance
npm run scraper:umi-vicostone
```

Other supplier runs are defined in `package.json` under the `scraper:*` scripts.

### Slab catalog import

```bash
npm run slabs:import
```

## Environment Variables

See `.env.example` for a safe template.

### App/API

Required:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_KEY`

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

### DB import and admin scripts

Required for scripts that connect directly to Postgres:

- `POSTGRES_PASSWORD`
  used by `scripts/import_msi_pricing.js` and `scripts/reconcile_stone_products.js`

Useful commands:

```bash
npm run pricing:msi-import
node scripts/reconcile_stone_products.js
```

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
- image upload naming is simplified to `remnant_<id>.<ext>`

## Notes

- Last scraper issues report is written to `scrapers/remnant_scraper/last_sync_issues.json` and is treated as generated output.
- The scraper uses the service role so it can resolve lookups and sync rows without being blocked by RLS.
- Status values in the app and database are lowercase: `available`, `hold`, `sold`.
- Scraper exports under `scrapers/slab_scraper/output/` are generated artifacts and are gitignored.
