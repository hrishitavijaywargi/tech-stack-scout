-- Tech Stack Scout — job queue functions (called by the Next.js server with the secret key)

-- Queue research for a set of companies. Idempotent: a company that already has a queued
-- or running job is skipped (partial unique index research_jobs_one_active_uq).
create or replace function public.enqueue_research(
  p_company_ids uuid[],
  p_job_type public.job_type,
  p_batch_label text default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_batch uuid;
  v_count int;
begin
  if p_batch_label is not null then
    insert into public.research_batches (label, job_type) values (p_batch_label, p_job_type)
    returning id into v_batch;
  end if;

  with ins as (
    insert into public.research_jobs (company_id, batch_id, job_type)
    select c.id, v_batch, p_job_type
    from public.companies c
    where c.id = any (p_company_ids) and c.watchlist_status = 'active'
    on conflict (company_id) where status in ('queued', 'running') do nothing
    returning company_id
  ), upd as (
    update public.companies c
    set research_status = 'queued', last_error = null
    from ins where c.id = ins.company_id
    returning c.id
  )
  select count(*) into v_count from upd;

  if v_batch is not null then
    if v_count = 0 then
      delete from public.research_batches where id = v_batch;
      v_batch := null;
    else
      update public.research_batches set total = v_count where id = v_batch;
    end if;
  end if;

  return jsonb_build_object(
    'batch_id', v_batch,
    'queued', v_count,
    'requested', coalesce(array_length(p_company_ids, 1), 0)
  );
end $$;

-- Atomically claim up to p_limit runnable jobs (FOR UPDATE SKIP LOCKED, so concurrent
-- workers never pick the same job). Also recovers jobs whose worker died mid-run.
create or replace function public.claim_research_jobs(
  p_limit int,
  p_lock_seconds int default 480
) returns setof public.research_jobs
language plpgsql security invoker set search_path = '' as $$
begin
  with stale as (
    update public.research_jobs
    set status = case when attempts >= max_attempts then 'failed'::public.job_status else 'queued'::public.job_status end,
        error_code = 'timeout',
        error_message = 'The worker stopped before this job finished (time limit). It was re-queued automatically.',
        locked_until = null,
        run_after = now(),
        completed_at = case when attempts >= max_attempts then now() end
    where status = 'running' and locked_until < now()
    returning company_id, status
  )
  update public.companies c
  set research_status = case when s.status = 'failed' then 'failed'::public.research_status else 'queued'::public.research_status end,
      last_error = case when s.status = 'failed' then 'Research timed out repeatedly' else c.last_error end
  from stale s where c.id = s.company_id;

  return query
  with picked as (
    select j.id from public.research_jobs j
    where j.status = 'queued' and j.run_after <= now()
    order by j.run_after, j.created_at
    for update skip locked
    limit greatest(p_limit, 0)
  ), claimed as (
    update public.research_jobs j
    set status = 'running',
        attempts = j.attempts + 1,
        started_at = now(),
        locked_until = now() + make_interval(secs => p_lock_seconds),
        error_code = null,
        error_message = null
    from picked where j.id = picked.id
    returning j.*
  ), mark as (
    update public.companies c set research_status = 'researching'
    from claimed where c.id = claimed.company_id
    returning c.id
  )
  select claimed.* from claimed;
end $$;

-- Weekly refresh: queue every active company whose next refresh is due. The window lets a
-- once-a-week trigger catch companies that become due a few hours after it fires.
create or replace function public.enqueue_due_refreshes(p_window_hours int default 12)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.companies
  where watchlist_status = 'active'
    and next_refresh_at is not null
    and next_refresh_at <= now() + make_interval(hours => p_window_hours);

  if v_ids is null then
    return jsonb_build_object('batch_id', null, 'queued', 0, 'requested', 0);
  end if;

  return public.enqueue_research(
    v_ids, 'scheduled', 'Scheduled refresh ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
  );
end $$;

revoke execute on function public.enqueue_research(uuid[], public.job_type, text) from public, anon, authenticated;
revoke execute on function public.claim_research_jobs(int, int) from public, anon, authenticated;
revoke execute on function public.enqueue_due_refreshes(int) from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
grant execute on function public.enqueue_research(uuid[], public.job_type, text) to service_role;
grant execute on function public.claim_research_jobs(int, int) to service_role;
grant execute on function public.enqueue_due_refreshes(int) to service_role;
