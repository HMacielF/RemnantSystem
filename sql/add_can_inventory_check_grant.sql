-- One-off: add `can_inventory_check` capability to profiles.
--
-- Lets super_admin grant individual non-super-admin staff access to the
-- Inventory Check workflow at /manage/inventory-check without elevating
-- their `system_role`. Toggle the column on/off from /admin's profiles
-- row editor; revoke when the count is done.
--
-- Defaults to false so existing rows stay locked down. Idempotent —
-- safe to re-run.

alter table public.profiles
  add column if not exists can_inventory_check boolean not null default false;

-- Verification (run after):
--   select id, email, system_role, can_inventory_check from public.profiles
--    order by created_at desc
--    limit 20;
