create table if not exists public.remnant_sales (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  sold_by_user_id uuid references public.profiles(id) on delete set null,
  sold_at timestamptz not null default now(),
  job_number text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.remnant_sales
add column if not exists remnant_id bigint references public.remnants(id) on delete cascade,
add column if not exists company_id bigint references public.companies(id) on delete set null,
add column if not exists sold_by_user_id uuid references public.profiles(id) on delete set null,
add column if not exists sold_at timestamptz default now(),
add column if not exists job_number text,
add column if not exists notes text,
add column if not exists created_at timestamptz default now(),
add column if not exists updated_at timestamptz default now();

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'remnant_sales'
      and column_name = 'project_reference'
  ) then
    execute $sql$
      update public.remnant_sales
      set job_number = coalesce(nullif(job_number, ''), project_reference)
      where coalesce(nullif(job_number, ''), '') = ''
        and project_reference is not null
    $sql$;
  end if;
end $$;

update public.remnant_sales
set sold_at = coalesce(sold_at, created_at, now())
where sold_at is null;

update public.remnant_sales
set created_at = coalesce(created_at, sold_at, now())
where created_at is null;

update public.remnant_sales
set updated_at = coalesce(updated_at, created_at, sold_at, now())
where updated_at is null;

do $$
begin
  if not exists (
    select 1
    from public.remnant_sales
    where job_number is null or btrim(job_number) = ''
  ) then
    alter table public.remnant_sales
    alter column job_number set not null;
  end if;
end $$;

create index if not exists idx_remnant_sales_remnant_id
  on public.remnant_sales(remnant_id);

create index if not exists idx_remnant_sales_sold_at
  on public.remnant_sales(sold_at desc);

create index if not exists idx_remnant_sales_sold_by_user_id
  on public.remnant_sales(sold_by_user_id);

alter table public.remnant_sales enable row level security;

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

create or replace function public.set_remnant_sales_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_remnant_sales_updated_at on public.remnant_sales;
create trigger set_remnant_sales_updated_at
before update on public.remnant_sales
for each row
execute function public.set_remnant_sales_updated_at();
