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

  if next_system_role not in ('super_admin', 'manager', 'status_user') then
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

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

drop function if exists public.handle_new_auth_user();

insert into public.profiles (
  id,
  email,
  full_name,
  system_role,
  company_id,
  active
)
select
  u.id,
  lower(nullif(trim(u.email), '')),
  nullif(trim(coalesce(
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name',
    u.raw_app_meta_data ->> 'full_name',
    u.raw_app_meta_data ->> 'name'
  )), ''),
  case
    when lower(nullif(trim(coalesce(
      u.raw_app_meta_data ->> 'system_role'
    )), '')) in ('super_admin', 'manager', 'status_user')
      then lower(trim(coalesce(
        u.raw_app_meta_data ->> 'system_role'
      )))
    else 'status_user'
  end,
  case
    when coalesce(
      u.raw_app_meta_data ->> 'company_id',
      ''
    ) ~ '^\d+$'
      then coalesce(
        u.raw_app_meta_data ->> 'company_id'
      )::bigint
    else null
  end,
  true
from auth.users u
left join public.profiles p
  on p.id = u.id
where p.id is null;
