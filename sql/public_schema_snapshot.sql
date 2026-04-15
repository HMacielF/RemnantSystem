-- Reference snapshot of the current public schema in Supabase project
-- gixklwrdzrwojqoddehn as of 2026-04-05.
--
-- This is a compact repo-side schema reference. It is intentionally more
-- readable than a raw dump and excludes seed data, auth setup, storage, and
-- Edge Functions.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_remnant_sales_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create schema if not exists private;

revoke all on schema private from public;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_email text;
  next_full_name text;
  next_system_role text;
  next_company_id bigint;
begin
  next_email := lower(nullif(trim(new.email), ''));
  next_full_name := nullif(trim(coalesce(
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'name',
    new.raw_app_meta_data ->> 'full_name',
    new.raw_app_meta_data ->> 'name'
  )), '');

  next_system_role := lower(nullif(trim(coalesce(
    new.raw_app_meta_data ->> 'system_role'
  )), ''));

  if next_system_role is null or next_system_role not in ('super_admin', 'manager', 'status_user') then
    next_system_role := 'status_user';
  end if;

  if coalesce(
    new.raw_app_meta_data ->> 'company_id',
    ''
  ) ~ '^\d+$' then
    next_company_id := coalesce(
      new.raw_app_meta_data ->> 'company_id'
    )::bigint;
  else
    next_company_id := null;
  end if;

  insert into public.profiles (
    id,
    email,
    full_name,
    system_role,
    company_id,
    active
  )
  values (
    new.id,
    next_email,
    next_full_name,
    next_system_role,
    next_company_id,
    true
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      system_role = coalesce(public.profiles.system_role, excluded.system_role),
      company_id = coalesce(public.profiles.company_id, excluded.company_id);

  return new;
end;
$$;

-- See sql/approve_hold_request.sql for the operational hold approval function.

create table if not exists public.companies (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.thicknesses (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  system_role text not null check (system_role in ('super_admin', 'manager', 'status_user')),
  company_id bigint references public.companies(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.remnants (
  id bigint generated always as identity primary key,
  company_id bigint not null references public.companies(id) on delete restrict,
  material_id bigint not null references public.materials(id) on delete restrict,
  thickness_id bigint not null references public.thicknesses(id) on delete restrict,
  name text not null,
  width numeric(10,2) not null check (width > 0),
  height numeric(10,2) not null check (height > 0),
  l_shape boolean not null default false,
  l_width numeric(10,2) check (l_width is null or l_width > 0),
  l_height numeric(10,2) check (l_height is null or l_height > 0),
  status text not null default 'available' check (status in ('available', 'hold', 'sold')),
  location text,
  hash text not null,
  image text,
  updated_at timestamptz,
  photo_hash text,
  image_path text,
  photo_synced_at timestamptz,
  source_image_url text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  last_seen_at timestamptz,
  moraware_remnant_id bigint unique
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_role text,
  actor_company_id bigint references public.companies(id) on delete set null,
  event_type text not null,
  entity_type text not null,
  entity_id bigint,
  remnant_id bigint references public.remnants(id) on delete set null,
  company_id bigint references public.companies(id) on delete set null,
  message text,
  old_data jsonb,
  new_data jsonb,
  meta jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.holds (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete restrict,
  hold_owner_user_id uuid not null references public.profiles(id) on delete restrict,
  hold_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null check (status in ('active', 'expired', 'released', 'sold')),
  notes text,
  job_number text,
  released_at timestamptz,
  released_by_user_id uuid references public.profiles(id) on delete set null,
  reassigned_from_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holds_expiration_after_start check (expires_at > hold_started_at)
);

create table if not exists public.hold_requests (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  sales_rep_user_id uuid references public.profiles(id) on delete set null,
  sales_rep_name text,
  notes text,
  job_number text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_queue (
  id bigint generated always as identity primary key,
  notification_type text not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  target_email text,
  remnant_id bigint references public.remnants(id) on delete set null,
  hold_id bigint references public.holds(id) on delete set null,
  hold_request_id bigint references public.hold_requests(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  error text,
  created_at timestamptz not null default now()
);

create table if not exists public.remnant_sales (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  sold_by_user_id uuid references public.profiles(id) on delete set null,
  sold_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  job_number text not null
);

create table if not exists public.suppliers (
  id bigint generated always as identity primary key,
  name text not null unique,
  website_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  inventory_url text,
  notes text
);

create table if not exists public.colors (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finishes (
  id bigint generated always as identity primary key,
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slabs (
  id bigint generated always as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  material_id bigint not null references public.materials(id) on delete restrict,
  name text not null,
  color_tone text,
  detail_url text not null,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  width text,
  height text
);

create table if not exists public.slab_colors (
  slab_id bigint not null references public.slabs(id) on delete cascade,
  color_id bigint not null references public.colors(id) on delete restrict,
  role text not null check (role in ('primary', 'accent')),
  created_at timestamptz not null default now(),
  primary key (slab_id, color_id, role)
);

create table if not exists public.slab_finishes (
  slab_id bigint not null references public.slabs(id) on delete cascade,
  finish_id bigint not null references public.finishes(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (slab_id, finish_id)
);

create table if not exists public.slab_thicknesses (
  slab_id bigint not null references public.slabs(id) on delete cascade,
  thickness_id bigint not null references public.thicknesses(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (slab_id, thickness_id)
);

create table if not exists public.supplier_brands (
  id bigint generated by default as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  brand_name text not null,
  material_id bigint references public.materials(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_brands_unique unique (supplier_id, brand_name)
);

create table if not exists public.supplier_contacts (
  id bigint generated by default as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  name text not null,
  phone_office text,
  phone_mobile text,
  email text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_locations (
  id bigint generated by default as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  address_line_1 text,
  city text,
  state text,
  postal_code text,
  hours text,
  appointment_notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_terms (
  id bigint generated by default as identity primary key,
  supplier_id bigint not null unique references public.suppliers(id) on delete cascade,
  sample_fee_text text,
  tax_text text,
  payment_terms text,
  credit_terms text,
  min_slab_purchase_text text,
  ordering_method text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_materials (
  id bigint generated by default as identity primary key,
  supplier_id bigint not null references public.suppliers(id) on delete cascade,
  material_id bigint not null references public.materials(id) on delete restrict,
  available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_materials_unique unique (supplier_id, material_id)
);

create index if not exists idx_companies_name
  on public.companies(name);

create index if not exists idx_materials_name
  on public.materials(name);

create index if not exists idx_thicknesses_name
  on public.thicknesses(name);

create index if not exists idx_profiles_company_id
  on public.profiles(company_id);

create index if not exists idx_profiles_system_role
  on public.profiles(system_role);

create index if not exists idx_remnants_company_id
  on public.remnants(company_id);

create index if not exists idx_remnants_deleted_at
  on public.remnants(deleted_at);

create index if not exists idx_remnants_material_id
  on public.remnants(material_id);

create index if not exists idx_remnants_name
  on public.remnants(name);

create index if not exists idx_remnants_status
  on public.remnants(status);

create index if not exists idx_remnants_thickness_id
  on public.remnants(thickness_id);

create index if not exists idx_audit_logs_actor_user_id
  on public.audit_logs(actor_user_id);

create index if not exists idx_audit_logs_created_at
  on public.audit_logs(created_at desc);

create index if not exists idx_audit_logs_entity_type_entity_id
  on public.audit_logs(entity_type, entity_id);

create index if not exists idx_audit_logs_remnant_id
  on public.audit_logs(remnant_id);

create unique index if not exists idx_holds_one_active_per_remnant
  on public.holds(remnant_id)
  where status = 'active';

create index if not exists idx_holds_owner
  on public.holds(hold_owner_user_id);

create index if not exists idx_holds_status
  on public.holds(status);

create index if not exists idx_holds_expires_at
  on public.holds(expires_at);

create index if not exists idx_holds_company_id
  on public.holds(company_id);

create index if not exists idx_hold_requests_remnant_id
  on public.hold_requests(remnant_id);

create index if not exists idx_hold_requests_sales_rep
  on public.hold_requests(sales_rep_user_id);

create index if not exists idx_hold_requests_status
  on public.hold_requests(status);

create index if not exists idx_notification_queue_status_scheduled
  on public.notification_queue(status, scheduled_for);

create index if not exists idx_notification_queue_target_user_id
  on public.notification_queue(target_user_id);

create index if not exists idx_remnant_sales_remnant_id
  on public.remnant_sales(remnant_id);

create index if not exists idx_remnant_sales_sold_at
  on public.remnant_sales(sold_at desc);

create index if not exists idx_remnant_sales_sold_by_user_id
  on public.remnant_sales(sold_by_user_id);

create index if not exists slabs_active_idx
  on public.slabs(active);

create index if not exists slabs_material_id_idx
  on public.slabs(material_id);

create index if not exists slabs_supplier_id_idx
  on public.slabs(supplier_id);

create index if not exists slabs_supplier_material_name_idx
  on public.slabs(supplier_id, material_id, name);

create index if not exists slab_colors_color_id_idx
  on public.slab_colors(color_id);

create index if not exists slab_colors_role_idx
  on public.slab_colors(role);

create index if not exists slab_finishes_finish_id_idx
  on public.slab_finishes(finish_id);

create index if not exists slab_thicknesses_thickness_id_idx
  on public.slab_thicknesses(thickness_id);

create index if not exists supplier_brands_supplier_id_idx
  on public.supplier_brands(supplier_id);

create index if not exists supplier_brands_material_id_idx
  on public.supplier_brands(material_id);

create index if not exists supplier_contacts_supplier_id_idx
  on public.supplier_contacts(supplier_id);

create index if not exists supplier_locations_supplier_id_idx
  on public.supplier_locations(supplier_id);

create index if not exists supplier_materials_supplier_id_idx
  on public.supplier_materials(supplier_id);

create index if not exists supplier_materials_material_id_idx
  on public.supplier_materials(material_id);

drop trigger if exists set_remnants_updated_at on public.remnants;
create trigger set_remnants_updated_at
before update on public.remnants
for each row
execute function public.set_updated_at();

drop trigger if exists set_holds_updated_at on public.holds;
create trigger set_holds_updated_at
before update on public.holds
for each row
execute function public.set_updated_at();

drop trigger if exists set_hold_requests_updated_at on public.hold_requests;
create trigger set_hold_requests_updated_at
before update on public.hold_requests
for each row
execute function public.set_updated_at();

drop trigger if exists set_remnant_sales_updated_at on public.remnant_sales;
create trigger set_remnant_sales_updated_at
before update on public.remnant_sales
for each row
execute function public.set_remnant_sales_updated_at();

drop trigger if exists set_suppliers_updated_at on public.suppliers;
create trigger set_suppliers_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();

drop trigger if exists set_colors_updated_at on public.colors;
create trigger set_colors_updated_at
before update on public.colors
for each row
execute function public.set_updated_at();

drop trigger if exists set_finishes_updated_at on public.finishes;
create trigger set_finishes_updated_at
before update on public.finishes
for each row
execute function public.set_updated_at();

drop trigger if exists set_slabs_updated_at on public.slabs;
create trigger set_slabs_updated_at
before update on public.slabs
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_brands_set_updated_at on public.supplier_brands;
create trigger supplier_brands_set_updated_at
before update on public.supplier_brands
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_contacts_set_updated_at on public.supplier_contacts;
create trigger supplier_contacts_set_updated_at
before update on public.supplier_contacts
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_locations_set_updated_at on public.supplier_locations;
create trigger supplier_locations_set_updated_at
before update on public.supplier_locations
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_materials_set_updated_at on public.supplier_materials;
create trigger supplier_materials_set_updated_at
before update on public.supplier_materials
for each row
execute function public.set_updated_at();

drop trigger if exists supplier_terms_set_updated_at on public.supplier_terms;
create trigger supplier_terms_set_updated_at
before update on public.supplier_terms
for each row
execute function public.set_updated_at();

alter table public.companies enable row level security;
alter table public.materials enable row level security;
alter table public.thicknesses enable row level security;
alter table public.profiles enable row level security;
alter table public.remnants enable row level security;
alter table public.audit_logs enable row level security;
alter table public.holds enable row level security;
alter table public.hold_requests enable row level security;
alter table public.notification_queue enable row level security;
alter table public.remnant_sales enable row level security;
alter table public.suppliers enable row level security;
alter table public.colors enable row level security;
alter table public.finishes enable row level security;
alter table public.slabs enable row level security;
alter table public.slab_colors enable row level security;
alter table public.slab_finishes enable row level security;
alter table public.slab_thicknesses enable row level security;
alter table public.supplier_brands enable row level security;
alter table public.supplier_contacts enable row level security;
alter table public.supplier_locations enable row level security;
alter table public.supplier_terms enable row level security;
alter table public.supplier_materials enable row level security;

drop policy if exists "authenticated users can view own profile" on public.profiles;
create policy "authenticated users can view own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();
