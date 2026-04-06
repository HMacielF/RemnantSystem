-- Normalize shared stone metadata across slabs and remnants.
--
-- Goals:
-- 1. A remnant can remain its own row and optionally point to a parent slab.
-- 2. Slabs and remnants can share one canonical stone product record.
-- 3. Colors are entered once per shared stone product, with optional remnant-only overrides.
-- 4. Brand can be extracted once and stored centrally instead of repeating it on every remnant.
--
-- This migration is additive on purpose:
-- - it keeps existing `slabs.name` and `remnants.name` for app compatibility
-- - it backfills new relations from current data
-- - it does not drop any legacy columns yet

create or replace function public.normalize_catalog_name(p_value text)
returns text
language sql
immutable
as $$
  select lower(
    trim(
      regexp_replace(
        coalesce(p_value, ''),
        '\s+',
        ' ',
        'g'
      )
    )
  );
$$;

create table if not exists public.stone_products (
  id bigint generated always as identity primary key,
  material_id bigint not null references public.materials(id) on delete restrict,
  display_name text not null,
  stone_name text not null,
  brand_name text,
  normalized_name text generated always as (public.normalize_catalog_name(display_name)) stored,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stone_products_display_name_not_blank check (btrim(display_name) <> ''),
  constraint stone_products_stone_name_not_blank check (btrim(stone_name) <> '')
);

create unique index if not exists stone_products_material_name_unique
  on public.stone_products(material_id, normalized_name);

create index if not exists stone_products_brand_name_idx
  on public.stone_products(brand_name);

create index if not exists stone_products_material_id_idx
  on public.stone_products(material_id);

drop trigger if exists stone_products_set_updated_at on public.stone_products;
create trigger stone_products_set_updated_at
before update on public.stone_products
for each row
execute function public.set_updated_at();

create table if not exists public.stone_product_colors (
  stone_product_id bigint not null references public.stone_products(id) on delete cascade,
  color_id bigint not null references public.colors(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'accent')),
  created_at timestamptz not null default now(),
  primary key (stone_product_id, color_id, role)
);

create index if not exists stone_product_colors_color_id_idx
  on public.stone_product_colors(color_id);

alter table public.slabs
  add column if not exists stone_product_id bigint references public.stone_products(id) on delete set null;

create index if not exists slabs_stone_product_id_idx
  on public.slabs(stone_product_id);

alter table public.remnants
  add column if not exists stone_product_id bigint references public.stone_products(id) on delete set null,
  add column if not exists parent_slab_id bigint references public.slabs(id) on delete set null;

create index if not exists remnants_stone_product_id_idx
  on public.remnants(stone_product_id);

create index if not exists remnants_parent_slab_id_idx
  on public.remnants(parent_slab_id);

create table if not exists public.remnant_colors (
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  color_id bigint not null references public.colors(id) on delete restrict,
  role text not null default 'primary' check (role in ('primary', 'accent')),
  created_at timestamptz not null default now(),
  primary key (remnant_id, color_id, role)
);

create index if not exists remnant_colors_color_id_idx
  on public.remnant_colors(color_id);

-- Build one shared stone product row for each distinct material + stone name
-- currently present in slabs or remnants.
insert into public.stone_products (
  material_id,
  display_name,
  stone_name
)
select distinct
  src.material_id,
  src.display_name,
  src.display_name
from (
  select s.material_id, btrim(s.name) as display_name
  from public.slabs s
  where btrim(coalesce(s.name, '')) <> ''

  union

  select r.material_id, btrim(r.name) as display_name
  from public.remnants r
  where btrim(coalesce(r.name, '')) <> ''
) src
on conflict (material_id, normalized_name) do nothing;

update public.slabs s
set stone_product_id = sp.id
from public.stone_products sp
where s.material_id = sp.material_id
  and sp.normalized_name = public.normalize_catalog_name(s.name)
  and s.stone_product_id is distinct from sp.id;

update public.remnants r
set stone_product_id = sp.id
from public.stone_products sp
where r.material_id = sp.material_id
  and sp.normalized_name = public.normalize_catalog_name(r.name)
  and r.stone_product_id is distinct from sp.id;

-- Promote slab-level colors into the shared stone product layer so multiple
-- remnants of the same stone can reuse them without duplicate data entry.
insert into public.stone_product_colors (
  stone_product_id,
  color_id,
  role
)
select distinct
  s.stone_product_id,
  sc.color_id,
  sc.role
from public.slabs s
join public.slab_colors sc on sc.slab_id = s.id
where s.stone_product_id is not null
on conflict do nothing;

-- If a stone product matches exactly one slab, use that as the default parent
-- slab for remnants of the same shared stone.
with uniquely_identified_slabs as (
  select
    stone_product_id,
    min(id) as slab_id
  from public.slabs
  where stone_product_id is not null
  group by stone_product_id
  having count(*) = 1
)
update public.remnants r
set parent_slab_id = uis.slab_id
from uniquely_identified_slabs uis
where r.stone_product_id = uis.stone_product_id
  and r.parent_slab_id is null;

-- Best-effort brand extraction:
-- if a slab supplier has a known brand whose name is an exact prefix of the
-- shared display name, store that brand once on the stone product.
with ranked_brand_matches as (
  select
    sp.id as stone_product_id,
    sb.brand_name,
    row_number() over (
      partition by sp.id
      order by char_length(sb.brand_name) desc, sb.brand_name asc
    ) as rn
  from public.stone_products sp
  join public.slabs s
    on s.stone_product_id = sp.id
  join public.supplier_brands sb
    on sb.supplier_id = s.supplier_id
  where sp.brand_name is null
    and (
      public.normalize_catalog_name(sp.display_name) = public.normalize_catalog_name(sb.brand_name)
      or public.normalize_catalog_name(sp.display_name) like public.normalize_catalog_name(sb.brand_name) || ' %'
    )
)
update public.stone_products sp
set brand_name = rbm.brand_name
from ranked_brand_matches rbm
where sp.id = rbm.stone_product_id
  and rbm.rn = 1
  and sp.brand_name is null;

-- Optional cleanup: if a brand prefix was detected, strip it from stone_name
-- so brand + stone name can be edited independently later.
update public.stone_products
set stone_name = btrim(substr(display_name, char_length(brand_name) + 1))
where brand_name is not null
  and public.normalize_catalog_name(display_name) like public.normalize_catalog_name(brand_name) || ' %'
  and btrim(substr(display_name, char_length(brand_name) + 1)) <> '';

create or replace view public.remnant_effective_colors as
select
  rc.remnant_id,
  rc.color_id,
  rc.role,
  'remnant'::text as source
from public.remnant_colors rc

union all

select
  r.id as remnant_id,
  spc.color_id,
  spc.role,
  'stone_product'::text as source
from public.remnants r
join public.stone_product_colors spc
  on spc.stone_product_id = r.stone_product_id
where not exists (
  select 1
  from public.remnant_colors rc
  where rc.remnant_id = r.id
)

union all

select
  r.id as remnant_id,
  sc.color_id,
  sc.role,
  'slab'::text as source
from public.remnants r
join public.slab_colors sc
  on sc.slab_id = r.parent_slab_id
where not exists (
  select 1
  from public.remnant_colors rc
  where rc.remnant_id = r.id
)
and not exists (
  select 1
  from public.stone_product_colors spc
  where spc.stone_product_id = r.stone_product_id
);

alter table public.stone_products enable row level security;
alter table public.stone_product_colors enable row level security;
alter table public.remnant_colors enable row level security;

drop policy if exists "public can view active stone products" on public.stone_products;
create policy "public can view active stone products"
on public.stone_products
for select
to public
using (active = true);

drop policy if exists "public can view stone product colors" on public.stone_product_colors;
create policy "public can view stone product colors"
on public.stone_product_colors
for select
to public
using (true);

drop policy if exists "public can view remnant colors" on public.remnant_colors;
create policy "public can view remnant colors"
on public.remnant_colors
for select
to public
using (true);
