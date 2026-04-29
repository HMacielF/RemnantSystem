-- One-off cleanup: collapse "Dolomitic Marble" -> "Dolomite"
--
-- The Bramati importer in scripts/import_missing_supplier_catalogs.js was
-- previously normalizing rows whose source material was "dolomite" into the
-- material "Dolomitic Marble". The script has been corrected to emit
-- "Dolomite", but existing rows in `materials` (and every table that
-- references it via `material_id`) need to be reconciled.
--
-- Behavior:
--   * If only "Dolomitic Marble" exists: rename it to "Dolomite" in place.
--   * If both exist: merge — repoint every reference, dedupe rows that would
--     collide on a unique constraint, then delete the orphaned material.
--   * If only "Dolomite" exists (or neither): no-op.
--
-- Unique constraints that need pre-merge handling when both materials exist:
--   - supplier_materials: UNIQUE (supplier_id, material_id)
--   - stone_products:     UNIQUE (material_id, normalized_name)  ← this is
--     where the previous run failed (e.g. "Fantasy Brown" exists on both
--     materials). The duplicate stone_products row is merged first by
--     repointing slabs/remnants/stone_product_colors.
--   - supplier_brands:    UNIQUE (supplier_id, brand_name)  — material_id is
--     not part of the constraint, so the rename is collision-free here.
--
-- Run inside a transaction so a failure rolls everything back cleanly.

begin;

do $$
declare
  bad_id  bigint;
  good_id bigint;
  dup record;
begin
  select id into bad_id  from public.materials where lower(name) = 'dolomitic marble' limit 1;
  select id into good_id from public.materials where lower(name) = 'dolomite'         limit 1;

  if bad_id is null then
    raise notice 'No "Dolomitic Marble" row found — nothing to do.';
    return;
  end if;

  if good_id is null then
    update public.materials set name = 'Dolomite' where id = bad_id;
    raise notice 'Renamed material id % from "Dolomitic Marble" to "Dolomite".', bad_id;
    return;
  end if;

  if bad_id = good_id then
    raise notice 'Both names resolve to the same row — nothing to do.';
    return;
  end if;

  -- 1) supplier_materials: drop rows that would collide on
  -- (supplier_id, material_id), then repoint the rest.
  delete from public.supplier_materials
   where material_id = bad_id
     and supplier_id in (
       select supplier_id from public.supplier_materials where material_id = good_id
     );
  update public.supplier_materials set material_id = good_id where material_id = bad_id;

  -- 2) stone_products: merge duplicates that share a normalized_name across
  -- the two materials. For each such pair, fold the bad-side row into the
  -- good-side row (slabs, remnants, colors), then delete the bad-side row.
  for dup in
    select bad_sp.id as bad_sp_id, good_sp.id as good_sp_id
      from public.stone_products bad_sp
      join public.stone_products good_sp
        on good_sp.material_id = good_id
       and good_sp.normalized_name = bad_sp.normalized_name
     where bad_sp.material_id = bad_id
  loop
    -- Repoint slabs/remnants from the duplicate stone_product to the survivor
    update public.slabs    set stone_product_id = dup.good_sp_id where stone_product_id = dup.bad_sp_id;
    update public.remnants set stone_product_id = dup.good_sp_id where stone_product_id = dup.bad_sp_id;

    -- Merge colors. PK is (stone_product_id, color_id, role); drop any
    -- bad-side rows whose (color_id, role) already exists on the good side,
    -- then repoint the rest.
    delete from public.stone_product_colors
     where stone_product_id = dup.bad_sp_id
       and (color_id, role) in (
         select color_id, role from public.stone_product_colors
          where stone_product_id = dup.good_sp_id
       );
    update public.stone_product_colors
       set stone_product_id = dup.good_sp_id
     where stone_product_id = dup.bad_sp_id;

    -- Delete the duplicate stone_product itself (any remaining cascades fire here)
    delete from public.stone_products where id = dup.bad_sp_id;

    raise notice 'Merged stone_product % -> %', dup.bad_sp_id, dup.good_sp_id;
  end loop;

  -- 3) Any stone_products on the bad side without a good-side counterpart can
  -- just have their material_id repointed.
  update public.stone_products set material_id = good_id where material_id = bad_id;

  -- 4) Repoint everything else. supplier_brands' UNIQUE doesn't include
  -- material_id; slabs/remnants/slab_supplier_prices have no UNIQUE involving it.
  update public.supplier_brands     set material_id = good_id where material_id = bad_id;
  update public.slabs               set material_id = good_id where material_id = bad_id;
  update public.remnants            set material_id = good_id where material_id = bad_id;
  update public.slab_supplier_prices set material_id = good_id where material_id = bad_id;

  delete from public.materials where id = bad_id;

  raise notice 'Repointed all material_id references from % to %, then deleted "Dolomitic Marble" (id %).',
    bad_id, good_id, bad_id;
end $$;

commit;

-- Verification queries (run after commit; expected: zero rows from each):
--   select id, name from public.materials where lower(name) = 'dolomitic marble';
--   select count(*) from public.remnants r
--     join public.materials m on m.id = r.material_id
--     where lower(m.name) = 'dolomitic marble';
--   select count(*) from public.slabs s
--     join public.materials m on m.id = s.material_id
--     where lower(m.name) = 'dolomitic marble';
--   select count(*) from public.stone_products
--     where material_id = (select id from public.materials where lower(name) = 'dolomitic marble');
