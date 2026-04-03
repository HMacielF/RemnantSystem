-- =========================================================
-- HOLD SYSTEM + REQUESTS + NOTIFICATION QUEUE
-- =========================================================

create table if not exists public.holds (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint not null references public.companies(id) on delete restrict,
  hold_owner_user_id uuid not null references public.profiles(id) on delete restrict,
  hold_started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null check (status in ('active', 'expired', 'released', 'sold')),
  notes text,
  project_reference text,
  job_number text,
  released_at timestamptz,
  released_by_user_id uuid references public.profiles(id) on delete set null,
  reassigned_from_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holds_expiration_after_start check (expires_at > hold_started_at)
);

create unique index if not exists idx_holds_one_active_per_remnant
on public.holds(remnant_id)
where status = 'active';

create index if not exists idx_holds_owner on public.holds(hold_owner_user_id);
create index if not exists idx_holds_status on public.holds(status);
create index if not exists idx_holds_expires_at on public.holds(expires_at);
create index if not exists idx_holds_company_id on public.holds(company_id);

drop trigger if exists set_holds_updated_at on public.holds;
create trigger set_holds_updated_at
before update on public.holds
for each row
execute function public.set_updated_at();


create table if not exists public.hold_requests (
  id bigint generated always as identity primary key,
  remnant_id bigint not null references public.remnants(id) on delete cascade,
  company_id bigint references public.companies(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  sales_rep_user_id uuid references public.profiles(id) on delete set null,
  sales_rep_name text,
  project_reference text,
  notes text,
  job_number text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_hold_requests_remnant_id on public.hold_requests(remnant_id);
create index if not exists idx_hold_requests_sales_rep on public.hold_requests(sales_rep_user_id);
create index if not exists idx_hold_requests_status on public.hold_requests(status);

drop trigger if exists set_hold_requests_updated_at on public.hold_requests;
create trigger set_hold_requests_updated_at
before update on public.hold_requests
for each row
execute function public.set_updated_at();


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
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_notification_queue_status_scheduled
on public.notification_queue(status, scheduled_for);
create index if not exists idx_notification_queue_target_user_id
on public.notification_queue(target_user_id);


alter table public.holds enable row level security;
alter table public.hold_requests enable row level security;
alter table public.notification_queue enable row level security;

create policy "authenticated users can view holds"
on public.holds
for select
to authenticated
using (true);

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

create policy "public users can create hold requests"
on public.hold_requests
for insert
to anon, authenticated
with check (status = 'pending');

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

revoke insert, update, delete on public.notification_queue from anon, authenticated;
grant insert on public.hold_requests to anon, authenticated;
