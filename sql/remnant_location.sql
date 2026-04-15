alter table public.remnants
  add column if not exists location text;

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
  r.stone_product_id,
  r.location
from public.remnants r
left join public.companies c on c.id = r.company_id
left join public.materials m on m.id = r.material_id
left join public.thicknesses t on t.id = r.thickness_id
where r.deleted_at is null;
