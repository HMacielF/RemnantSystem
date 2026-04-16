-- ============================================================
-- dispatch-notifications-cron.sql
-- Run these once in the Supabase SQL Editor.
-- ============================================================

-- 1. Atomic claim function
--    Marks rows as "processing" so concurrent runs never double-send.
--    The Edge Function calls this, gets the rows, then updates to sent/failed.
-- ============================================================
create or replace function public.claim_due_notifications(p_limit int default 20)
returns setof public.notification_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
    update public.notification_queue
    set status = 'processing'
    where id in (
      select id
      from   public.notification_queue
      where  status    = 'pending'
        and  scheduled_for <= now()
      order  by scheduled_for
      limit  p_limit
      for update skip locked
    )
    returning *;
end;
$$;

-- Add 'processing' to the status check constraint so the claim function works.
-- (Safe to run even if the constraint already includes it.)
alter table public.notification_queue
  drop constraint if exists notification_queue_status_check;

alter table public.notification_queue
  add constraint notification_queue_status_check
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled'));


-- 2. pg_cron schedule — fires every 2 minutes
--    Requires the pg_cron extension (enabled by default on Supabase).
-- ============================================================
select cron.schedule(
  'dispatch-notifications',                         -- job name (must be unique)
  '*/2 * * * *',                                    -- every 2 minutes
  $$
    select
      net.http_post(
        url    := current_setting('app.supabase_functions_url') || '/dispatch-notifications',
        headers := '{"Authorization": "Bearer ' || current_setting('app.service_role_key') || '"}'::jsonb,
        body   := '{}'::jsonb
      )
  $$
);

-- To verify the job was created:
--   select * from cron.job where jobname = 'dispatch-notifications';

-- To unschedule:
--   select cron.unschedule('dispatch-notifications');


-- 3. Retry failed notifications helper
--    Manually re-queue notifications that failed so they'll be retried.
-- ============================================================
create or replace function public.retry_failed_notifications(
  p_older_than_minutes int default 5
)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  update public.notification_queue
  set    status = 'pending',
         error  = null
  where  status = 'failed'
    and  created_at < now() - (p_older_than_minutes || ' minutes')::interval;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
