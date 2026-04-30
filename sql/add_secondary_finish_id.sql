-- One-off: add `secondary_finish_id` to public.remnants so a single physical
-- remnant can record both faces (e.g. polished one side, leathered the other).
--
-- ON DELETE SET NULL — if a finish lookup row is removed/deactivated the
-- remnant just loses its secondary finish, doesn't cascade-delete.
-- Idempotent — safe to re-run.

alter table public.remnants
  add column if not exists secondary_finish_id bigint
    references public.finishes(id) on delete set null;

-- Verification (run after):
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'remnants'
--      and column_name = 'secondary_finish_id';
