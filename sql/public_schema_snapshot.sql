-- Snapshot of the current public schema in Supabase project gixklwrdzrwojqoddehn.
-- This is intended as a copyable reference for recreating the public-side database
-- structure used by this app. It does not include seed data, auth configuration,
-- storage buckets, or Edge Functions.

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

create or replace function public.approve_hold_request(
  p_request_id bigint,
  p_hold_owner_user_id uuid,
  p_reviewed_by_user_id uuid,
  p_expires_at timestamptz,
  p_job_number text default null,
  p_notes text default null
)
returns table (
  hold_request_id bigint,
  hold_id bigint,
  remnant_id bigint,
  company_id bigint
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_request public.hold_requests%rowtype;
  v_remnant public.remnants%rowtype;
  v_hold_id bigint;
  v_job_number text;
  v_notes text;
begin
  select *
  into v_request
  from public.hold_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Hold request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Only pending hold requests can be approved';
  end if;

  select *
  into v_remnant
  from public.remnants
  where id = v_request.remnant_id
  for update;

  if not found or v_remnant.deleted_at is not null then
    raise exception 'Remnant not found';
  end if;

  if coalesce(v_remnant.status, '') = 'sold' then
    raise exception 'Sold remnants cannot be placed on hold';
  end if;

  if exists (
    select 1
    from public.holds h
    where h.remnant_id = v_request.remnant_id
      and h.status in ('active', 'expired')
    for update
  ) then
    raise exception 'This remnant already has a hold';
  end if;

  v_job_number := nullif(btrim(coalesce(p_job_number, v_request.job_number, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, v_request.notes, '')), '');

  if v_job_number is null then
    raise exception 'Job number is required to approve a hold request';
  end if;

  insert into public.holds (
    remnant_id,
    company_id,
    hold_owner_user_id,
    hold_started_at,
    expires_at,
    status,
    notes,
    job_number
  )
  values (
    v_request.remnant_id,
    v_request.company_id,
    p_hold_owner_user_id,
    now(),
    p_expires_at,
    'active',
    v_notes,
    v_job_number
  )
  returning id into v_hold_id;

  update public.remnants
  set status = 'hold'
  where id = v_request.remnant_id;

  update public.hold_requests
  set
    status = 'approved',
    reviewed_at = now(),
    reviewed_by_user_id = p_reviewed_by_user_id,
    job_number = v_job_number,
    notes = v_notes,
    updated_at = now()
  where id = v_request.id;

  return query
  select
    v_request.id,
    v_hold_id,
    v_request.remnant_id,
    v_request.company_id;
end;
$$;

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
  width bigint not null check (width > 0),
  height bigint not null check (height > 0),
  l_shape boolean not null default false,
  l_width bigint check (l_width is null or l_width > 0),
  l_height bigint check (l_height is null or l_height > 0),
  status text not null default 'available' check (status in ('available', 'hold', 'sold')),
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

drop policy if exists "authenticated users can view companies" on public.companies;
create policy "authenticated users can view companies"
on public.companies
for select
to authenticated
using (true);

drop policy if exists "super_admin can insert companies" on public.companies;
create policy "super_admin can insert companies"
on public.companies
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "super_admin can update companies" on public.companies;
create policy "super_admin can update companies"
on public.companies
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "authenticated users can view materials" on public.materials;
create policy "authenticated users can view materials"
on public.materials
for select
to authenticated
using (true);

drop policy if exists "super_admin and manager can insert materials" on public.materials;
create policy "super_admin and manager can insert materials"
on public.materials
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin and manager can update materials" on public.materials;
create policy "super_admin and manager can update materials"
on public.materials
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "authenticated users can view thicknesses" on public.thicknesses;
create policy "authenticated users can view thicknesses"
on public.thicknesses
for select
to authenticated
using (true);

drop policy if exists "super_admin and manager can insert thicknesses" on public.thicknesses;
create policy "super_admin and manager can insert thicknesses"
on public.thicknesses
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin and manager can update thicknesses" on public.thicknesses;
create policy "super_admin and manager can update thicknesses"
on public.thicknesses
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "authenticated users can view profiles" on public.profiles;
create policy "authenticated users can view profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "super_admin can insert profiles" on public.profiles;
create policy "super_admin can insert profiles"
on public.profiles
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "super_admin can update profiles" on public.profiles;
create policy "super_admin can update profiles"
on public.profiles
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "authenticated users can view remnants" on public.remnants;
create policy "authenticated users can view remnants"
on public.remnants
for select
to authenticated
using (true);

drop policy if exists "super_admin and manager can insert remnants" on public.remnants;
create policy "super_admin and manager can insert remnants"
on public.remnants
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin and manager can update all remnants" on public.remnants;
create policy "super_admin and manager can update all remnants"
on public.remnants
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "manager can view audit logs" on public.audit_logs;
create policy "manager can view audit logs"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'manager'
  )
);

drop policy if exists "super_admin can view audit logs" on public.audit_logs;
create policy "super_admin can view audit logs"
on public.audit_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "authenticated users can view holds" on public.holds;
create policy "authenticated users can view holds"
on public.holds
for select
to authenticated
using (true);

drop policy if exists "super_admin and manager can insert holds" on public.holds;
create policy "super_admin and manager can insert holds"
on public.holds
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin and manager can update holds" on public.holds;
create policy "super_admin and manager can update holds"
on public.holds
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "public users can create hold requests" on public.hold_requests;
create policy "public users can create hold requests"
on public.hold_requests
for insert
to anon, authenticated
with check (status = 'pending');

drop policy if exists "super_admin and manager can view hold requests" on public.hold_requests;
create policy "super_admin and manager can view hold requests"
on public.hold_requests
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin and manager can update hold requests" on public.hold_requests;
create policy "super_admin and manager can update hold requests"
on public.hold_requests
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
)
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager')
  )
);

drop policy if exists "super_admin can view notification queue" on public.notification_queue;
create policy "super_admin can view notification queue"
on public.notification_queue
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role = 'super_admin'
  )
);

drop policy if exists "authenticated users can view remnant sales" on public.remnant_sales;
create policy "authenticated users can view remnant sales"
on public.remnant_sales
for select
to authenticated
using (true);

drop policy if exists "super_admin manager and status_user can insert remnant sales" on public.remnant_sales;
create policy "super_admin manager and status_user can insert remnant sales"
on public.remnant_sales
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and p.system_role in ('super_admin', 'manager', 'status_user')
  )
);

create or replace view public.active_remnants as
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
grant insert on public.hold_requests to anon, authenticated;
revoke insert, update, delete on public.notification_queue from anon, authenticated;
