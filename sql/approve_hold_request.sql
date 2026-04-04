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
