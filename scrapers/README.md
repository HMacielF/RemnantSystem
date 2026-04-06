# Scrapers

This directory holds scraper-facing code that is separate from the main web app.

## Layout

- `remnant_scraper/`
  Canonical Moraware remnant sync package.
- `slab_scraper/`
  Supplier-specific slab catalog scrapers. Each supplier is implemented as its own module and writes JSON/CSV exports to `slab_scraper/output/`.
## Conventions

- One supplier per file.
- Keep each scraper runnable directly with `python3 -m scrapers.slab_scraper.<module>`.
- Export normalized records for downstream import rather than coupling scraper logic to Supabase writes.
- Treat `output/` as generated data, not source code.
