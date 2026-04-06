-- Bootstrap patches needed to make the fresh schema work with the current app.

alter table public.holds
  add column if not exists customer_name text;

create or replace function public.soft_delete_remnant(p_remnant_id bigint)
returns public.remnants
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.remnants%rowtype;
begin
  update public.remnants
  set
    deleted_at = now(),
    updated_at = now()
  where id = p_remnant_id
    and deleted_at is null
  returning * into v_row;

  if not found then
    select *
    into v_row
    from public.remnants
    where id = p_remnant_id;
  end if;

  return v_row;
end;
$$;

create or replace view public.active_remnants
as
select
  r.id as internal_remnant_id,
  coalesce(r.moraware_remnant_id, r.id) as id,
  r.name,
  r.width,
  r.height,
  r.l_shape,
  r.l_width,
  r.l_height,
  r.status,
  r.image,
  r.source_image_url,
  r.created_at,
  r.updated_at,
  c.name as company,
  m.name as material,
  t.name as thickness,
  r.company_id,
  r.material_id,
  r.thickness_id,
  r.parent_slab_id,
  r.stone_product_id
from public.remnants r
left join public.companies c on c.id = r.company_id
left join public.materials m on m.id = r.material_id
left join public.thicknesses t on t.id = r.thickness_id
where r.deleted_at is null;

grant select on public.active_remnants to anon, authenticated;

drop policy if exists "public can view active slabs" on public.slabs;
create policy "public can view active slabs"
on public.slabs
for select
to public
using (active = true);

drop policy if exists "public can view active suppliers" on public.suppliers;
create policy "public can view active suppliers"
on public.suppliers
for select
to public
using (active = true);

drop policy if exists "public can view materials" on public.materials;
create policy "public can view materials"
on public.materials
for select
to public
using (active = true);

drop policy if exists "public can view thicknesses" on public.thicknesses;
create policy "public can view thicknesses"
on public.thicknesses
for select
to public
using (active = true);

drop policy if exists "public can view slab colors" on public.slab_colors;
create policy "public can view slab colors"
on public.slab_colors
for select
to public
using (true);

drop policy if exists "public can view slab finishes" on public.slab_finishes;
create policy "public can view slab finishes"
on public.slab_finishes
for select
to public
using (true);

drop policy if exists "public can view slab thicknesses" on public.slab_thicknesses;
create policy "public can view slab thicknesses"
on public.slab_thicknesses
for select
to public
using (true);

drop policy if exists "public can view active remnants through base table" on public.remnants;
create policy "public can view active remnants through base table"
on public.remnants
for select
to public
using (deleted_at is null);

drop policy if exists "authenticated users can view own profile" on public.profiles;
create policy "authenticated users can view own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);
