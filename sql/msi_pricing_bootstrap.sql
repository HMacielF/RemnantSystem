create table if not exists public.supplier_price_tiers (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  material_id bigint references public.materials(id) on delete cascade,
  code text not null,
  sort_order integer not null,
  base_price_per_sqft numeric(10,4) not null,
  min_price_per_sqft numeric(10,4) not null default 0,
  max_price_per_sqft numeric(10,4) not null default 0,
  fixed_fee_per_sqft numeric(10,4) not null default 0,
  fee_percent_1 numeric(8,6) not null default 0.06,
  fee_percent_2 numeric(8,6) not null default 0.03,
  adjusted_price_per_sqft numeric(10,4) generated always as (
    round((((base_price_per_sqft + fixed_fee_per_sqft) * (1 + fee_percent_1) * (1 + fee_percent_2))::numeric), 4)
  ) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_price_tiers_code_key unique (supplier_id, material_id, code),
  constraint supplier_price_tiers_price_key unique (
    supplier_id,
    material_id,
    base_price_per_sqft,
    fixed_fee_per_sqft,
    fee_percent_1,
    fee_percent_2
  )
);

create table if not exists public.slab_supplier_prices (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  slab_id bigint not null references public.slabs(id) on delete cascade,
  material_id bigint references public.materials(id) on delete cascade,
  finish_id bigint references public.finishes(id) on delete set null,
  thickness_id bigint references public.thicknesses(id) on delete set null,
  tier_id bigint not null references public.supplier_price_tiers(id) on delete restrict,
  supplier_sku text,
  supplier_product_name text not null,
  source_group_number integer,
  source_group_label text,
  source_status text,
  size_label text,
  list_price_per_sqft numeric(10,4) not null,
  price_source text not null default 'msi_price_list_jan_2026',
  effective_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slab_supplier_prices_source_sku_key unique (price_source, supplier_sku)
);

create index if not exists idx_supplier_price_tiers_supplier_material
  on public.supplier_price_tiers(supplier_id, material_id, sort_order);

create index if not exists idx_slab_supplier_prices_slab
  on public.slab_supplier_prices(slab_id, active);

create index if not exists idx_slab_supplier_prices_tier
  on public.slab_supplier_prices(tier_id);

drop trigger if exists trg_supplier_price_tiers_updated_at on public.supplier_price_tiers;
create trigger trg_supplier_price_tiers_updated_at
before update on public.supplier_price_tiers
for each row execute function public.set_updated_at();

drop trigger if exists trg_slab_supplier_prices_updated_at on public.slab_supplier_prices;
create trigger trg_slab_supplier_prices_updated_at
before update on public.slab_supplier_prices
for each row execute function public.set_updated_at();

create or replace view public.slab_price_codes as
select
  spp.slab_id,
  spp.finish_id,
  spp.thickness_id,
  spp.size_label,
  spp.price_source,
  spp.source_group_number,
  spp.source_group_label,
  spt.code as price_code,
  spt.sort_order as price_code_sort_order
from public.slab_supplier_prices spp
join public.supplier_price_tiers spt on spt.id = spp.tier_id
where spp.active = true;

alter table public.supplier_price_tiers enable row level security;
alter table public.slab_supplier_prices enable row level security;
