-- One-off: create the "Travertine" material if it doesn't exist, then
-- reassign remnant #1012 (the staff-facing ID = moraware_remnant_id) to
-- point at it.
--
-- Defensive: matches the remnant by moraware_remnant_id first (the typical
-- "staff ID" shown on cards); also covers the case where the row's primary
-- key id literally equals 1012. Reports which rows it touched via NOTICE.
--
-- Wrapped in a transaction so a partial failure rolls back cleanly.

begin;

do $$
declare
  travertine_id bigint;
  matched_rows  bigint;
begin
  -- 1) Upsert "Travertine" into materials (case-insensitive lookup).
  select id into travertine_id from public.materials
   where lower(name) = 'travertine'
   limit 1;

  if travertine_id is null then
    insert into public.materials (name, active)
    values ('Travertine', true)
    returning id into travertine_id;
    raise notice 'Created material "Travertine" (id %).', travertine_id;
  else
    raise notice 'Material "Travertine" already exists (id %).', travertine_id;
  end if;

  -- 2) Reassign the remnant. Match by the staff-facing ID first
  -- (moraware_remnant_id), falling back to the raw primary key.
  update public.remnants
     set material_id = travertine_id
   where (moraware_remnant_id = 1012 or id = 1012);

  get diagnostics matched_rows = row_count;

  if matched_rows = 0 then
    raise warning 'No remnant matched moraware_remnant_id = 1012 or id = 1012 — nothing reassigned.';
  else
    raise notice 'Reassigned % remnant row(s) to material_id %.', matched_rows, travertine_id;
  end if;
end $$;

commit;

-- Verification (run after commit):
--   select r.id, r.moraware_remnant_id, m.name as material
--     from public.remnants r
--     join public.materials m on m.id = r.material_id
--    where r.moraware_remnant_id = 1012 or r.id = 1012;
--
--   -- Confirm the new material exists and is active:
--   select id, name, active from public.materials where lower(name) = 'travertine';
