# Remnant System — Web App

Next.js front-end for the Remnant System, backed by Supabase. Part of the monorepo root described in the top-level `README.md`.

## What this app does

Three workspaces in one Next.js deployment:

| Route | Audience | Purpose |
|---|---|---|
| `/` | Public (customers) | Browse live remnant inventory with filters, image previews, and hold requests |
| `/slabs` | Public | Browse the supplier slab catalog |
| `/manage` | `manager`, `status_user` | Approve holds, update status, upload/crop images, manage remnants |
| `/admin` | `super_admin` | Direct DB table editing without touching code |
| `/overview` | Internal | Quick workspace orientation page |
| `/portal` | All staff | Login / logout |

## Auth & roles

Auth is Supabase-managed (email + password, Google SSO via OAuth). Sessions are carried as httpOnly cookies (`access_token`, `refresh_token`) and refreshed transparently on every authenticated API response.

Three system roles exist in `public.profiles.system_role`:

- `super_admin` — full access including `/admin` DB workspace
- `manager` — create/edit/delete remnants, approve holds
- `status_user` — update statuses on remnants they own; read-only otherwise

## Project layout

```
apps/web/
├── src/
│   ├── app/                  Next.js App Router pages + API routes
│   │   ├── api/              Route handlers (authenticated under /api/*, public under /api/public/*)
│   │   ├── admin/            Super-admin workspace page
│   │   ├── manage/           Private management workspace page
│   │   ├── slabs/            Public slab catalog page
│   │   └── ...               Auth pages, public aliases
│   ├── components/           Client components (large interactive UIs)
│   └── server/               Server-side helpers
│       ├── private-api.js    All authenticated business logic
│       ├── public-api.js     All public (anon) business logic
│       ├── adminDbConfig.js  Admin table allowlist + column definitions
│       ├── public-route.js   CORS helpers for public routes
│       └── withApiHandler.js Route handler wrapper (auth + error handling)
├── server.js                 Custom Node server entry point
└── package.json
```

## Local development

**Requirements:** Node 24.x

```bash
# From monorepo root:
npm install
npm run web:dev
```

App runs at `http://localhost:3001`.

Useful commands:

```bash
npm run web:dev:clean    # clear Next cache and restart
npm run web:build        # production build
npm run web:lint         # ESLint
npm test                 # Jest unit tests (apps/web/jest.config.js)
```

## Environment variables

Copy `.env.example` to `.env.local` in `apps/web/`.

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | ✅ | Your project URL |
| `SUPABASE_ANON_KEY` or `SUPABASE_KEY` | ✅ | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Recommended | Required for trusted public-read endpoints and admin flows |
| `SMTP_HOST` | Optional | If unset, email notifications are queued but not sent |
| `SMTP_PORT` | Optional | Default 587 |
| `SMTP_USER` | Optional | |
| `SMTP_PASS` | Optional | |
| `SMTP_FROM` | Optional | Sender address |

## API surface

### Public (no auth required)
| Method | Path | Description |
|---|---|---|
| GET | `/api/public/remnants` | Filtered remnant list (reads `active_remnants` view) |
| POST | `/api/public/remnants/enrichment` | Enrich a list of remnant IDs with hold/sale/color data |
| GET | `/api/public/lookups` | Material and thickness lookup tables |
| GET | `/api/public/sales-reps` | Active sales reps for hold request form |
| GET | `/api/public/summary` | Inventory count summary |
| POST | `/api/public/hold-requests` | Submit a public hold request |

### Authenticated (cookie session required)
| Method | Path | Roles |
|---|---|---|
| GET | `/api/remnants` | all staff |
| POST | `/api/remnants` | manager, super_admin |
| PATCH | `/api/remnants/:id` | manager, super_admin |
| DELETE | `/api/remnants/:id` | manager, super_admin |
| POST | `/api/remnants/:id/status` | all staff |
| GET/POST | `/api/remnants/:id/hold` | all staff |
| PATCH | `/api/remnants/:id/image` | manager, super_admin |
| GET | `/api/hold-requests` | all staff |
| PATCH | `/api/hold-requests/:id` | manager, super_admin |
| POST | `/api/holds/:id/release` | all staff |
| GET/POST/PATCH/DELETE | `/api/admin/db/:table` | super_admin only |

## Deployment (Vercel)

Deploy from `apps/web`, not the monorepo root.

- **Framework preset:** Next.js
- **Root Directory:** `apps/web`
- **Node version:** 24.x
- Set all environment variables listed above in Vercel Dashboard → Settings → Environment Variables.

## Notification dispatch

Hold-related emails (hold requests, expiry warnings) are written to `public.notification_queue` at request time and dispatched by a Supabase Edge Function on a 2-minute cron schedule. See `supabase/functions/dispatch-notifications/` and `sql/dispatch-notifications-cron.sql` for setup details.
