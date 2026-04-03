drop view if exists public.active_remnants;

create view public.active_remnants as
select
  r.id as internal_remnant_id,
  coalesce(r.moraware_remnant_id, r.id) as id,
  c.name as company,
  m.name as material,
  t.name as thickness,
  r.name,
  r.width,
  r.height,
  r.l_shape,
  r.l_width,
  r.l_height,
  r.status,
  coalesce(r.image, r.source_image_url) as image
from public.remnants r
left join public.companies c on c.id = r.company_id
left join public.materials m on m.id = r.material_id
left join public.thicknesses t on t.id = r.thickness_id
where r.deleted_at is null;

grant select on public.active_remnants to anon, authenticated;
