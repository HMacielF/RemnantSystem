-- One-off: add a `hex` column to public.colors so the swatch helper can render
-- exact colors per lookup row instead of guessing from the name. Pre-fills the
-- column for every entry whose name matches the existing client-side palette
-- (workspace-utils.js colorSwatchStyle). Custom colors keep `hex = null` and
-- can be set by super-admin via /admin's profiles row editor (colors table).
--
-- Idempotent — safe to re-run. The UPDATE only touches rows whose name matches
-- one of the known palette keys; existing manually-set hex values for those
-- names get overwritten so the canonical palette stays the source of truth on
-- the first run, which is desirable on first deploy.

alter table public.colors
  add column if not exists hex text;

update public.colors set hex = '#d7b98c' where lower(trim(name)) in ('beige');
update public.colors set hex = '#1f1d1b' where lower(trim(name)) in ('black');
update public.colors set hex = '#e7c98b' where lower(trim(name)) in ('blonde');
update public.colors set hex = '#5b88d6' where lower(trim(name)) in ('blue');
update public.colors set hex = '#8b5a2b' where lower(trim(name)) in ('brown');
update public.colors set hex = '#f4ead2' where lower(trim(name)) in ('cream');
update public.colors set hex = '#d4af37' where lower(trim(name)) in ('gold');
update public.colors set hex = '#8b9098' where lower(trim(name)) in ('gray', 'grey');
update public.colors set hex = '#cfd4dc' where lower(trim(name)) in ('gray-light', 'gray light', 'light gray', 'light grey');
update public.colors set hex = '#5a5f68' where lower(trim(name)) in ('gray-dark', 'gray dark', 'dark gray', 'dark grey');
update public.colors set hex = '#6f956f' where lower(trim(name)) in ('green');
update public.colors set hex = '#284a7a' where lower(trim(name)) in ('navy');
update public.colors set hex = '#ff3b30' where lower(trim(name)) in ('red');
update public.colors set hex = '#8f7762' where lower(trim(name)) in ('taupe');
update public.colors set hex = '#ffffff' where lower(trim(name)) in ('white');

-- Verification (run after):
--   select id, name, hex, active from public.colors order by name;
--   -- Rows whose name doesn't match any of the palette keys keep hex = null
--   -- and will fall back to the in-app palette helper until super-admin sets
--   -- a hex via /admin.
