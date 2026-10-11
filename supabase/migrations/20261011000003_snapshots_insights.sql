-- Tech Stack Scout — v2 schema: per-refresh snapshots + insights, product profile, refresh runs.
-- Replaces research_reports / research_snapshots (their content now lives in
-- company_snapshots + company_insights). Research is re-run after this migration.

-- ---------------------------------------------------------------- companies
alter table public.companies rename column blog_url to blog_rss_url;
alter table public.companies
  add column job_board_provider text check (job_board_provider in ('greenhouse', 'lever', 'ashby')),
  add column job_board_slug text check (job_board_slug is null or job_board_slug ~ '^[A-Za-z0-9._%-]{1,100}$'),
  add column notes text,
  add column is_active boolean not null default true;

-- Carry over job boards written as careers URLs.
update public.companies set
  job_board_provider = case
    when careers_url ~* 'greenhouse\.io' then 'greenhouse'
    when careers_url ~* 'lever\.co' then 'lever'
    when careers_url ~* 'ashbyhq\.com' then 'ashby' end,
  job_board_slug = coalesce(
    substring(careers_url from '(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io/([A-Za-z0-9_-]+)'),
    substring(careers_url from 'jobs\.(?:eu\.)?lever\.co/([A-Za-z0-9._-]+)'),
    substring(careers_url from 'jobs\.ashbyhq\.com/([A-Za-z0-9._%-]+)'))
where careers_url is not null;
update public.companies set is_active = (watchlist_status = 'active');

drop index if exists public.companies_next_refresh_idx;
alter table public.companies drop column watchlist_status, drop column careers_url;
create index companies_next_refresh_idx on public.companies (next_refresh_at) where is_active;

-- Domain is required (it drives DNS, crt.sh, blog discovery and Hacker News matching).
delete from public.companies where domain is null;
alter table public.companies alter column domain set not null;
drop index if exists public.companies_domain_uq;
alter table public.companies add constraint companies_domain_key unique (domain);

-- ---------------------------------------------------------------- product profile
create table public.product_profile (
  id boolean primary key default true check (id),
  product_name text not null,
  one_liner text not null,
  description text not null,
  target_languages text[] not null default '{}',
  target_clouds text[] not null default '{}',
  target_signals text[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.product_profile (product_name, one_liner, description, target_languages, target_clouds, target_signals)
select
  product_name,
  'Faster CI, per-PR preview environments and a service catalog for cloud-native engineering teams.',
  product_description,
  array['Go', 'TypeScript', 'Java', 'Kotlin', 'Python'],
  array['AWS', 'Google Cloud', 'Microsoft Azure'],
  array['Microservices', 'Kubernetes', 'Docker', 'Monorepo', 'GitHub Actions', 'gRPC', 'Terraform']
from public.app_settings where id;
alter table public.app_settings drop column product_name, drop column product_description;
create trigger product_profile_touch before update on public.product_profile
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- refresh runs
create table public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'manual')),
  source text,                         -- vercel-weekly | vercel-daily | pg_cron | ui | chain
  status text not null default 'running' check (status in ('running', 'succeeded', 'partial', 'failed', 'idle')),
  companies_queued int not null default 0,
  companies_processed int not null default 0,
  errors jsonb not null default '[]'::jsonb
);
create index refresh_runs_started_idx on public.refresh_runs (started_at desc);

-- ---------------------------------------------------------------- snapshots + insights
alter table public.research_jobs drop constraint if exists research_jobs_report_fk;
alter table public.research_jobs drop column if exists report_id;
drop table if exists public.research_snapshots;
drop table if exists public.research_reports;

create table public.company_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id uuid references public.research_jobs (id) on delete set null,
  run_id uuid references public.refresh_runs (id) on delete set null,
  version int not null check (version > 0),
  captured_at timestamptz not null default now(),
  languages jsonb not null default '[]'::jsonb,          -- [{name, bytes, pct}] all-time
  recent_languages jsonb not null default '[]'::jsonb,   -- [{name, bytes, pct}] repos pushed in last 180 d
  infra_signals jsonb not null default '[]'::jsonb,      -- [{tech, category, confidence, evidence:[{source, detail, url, date}]}]
  activity jsonb not null default '{}'::jsonb,
  hiring jsonb not null default '{}'::jsonb,
  dns jsonb not null default '{}'::jsonb,
  subdomains jsonb not null default '{}'::jsonb,
  hn_stories jsonb not null default '[]'::jsonb,
  blog_posts jsonb not null default '[]'::jsonb,
  web_research jsonb not null default '{}'::jsonb,
  activity_score int not null check (activity_score between 0 and 100),
  fit_score int not null check (fit_score between 0 and 100),
  score_breakdown jsonb not null default '{}'::jsonb,    -- {activity:[…], fit:[…]}
  confidence jsonb not null default '{}'::jsonb,         -- overall research confidence (defined method)
  source_status jsonb not null default '{}'::jsonb,      -- {source: {status, message, duration_ms, items}}
  github_identification jsonb not null default '{}'::jsonb,
  evidence_facts jsonb not null default '[]'::jsonb,     -- ID'd facts given to Gemini (F1, R1, J1…)
  limitations text[] not null default '{}',
  missing_information text[] not null default '{}',
  sources_analyzed int not null default 0,
  changes jsonb not null default '[]'::jsonb,            -- diff vs previous snapshot (What's changed?)
  previous_snapshot_id uuid references public.company_snapshots (id) on delete set null,
  unique (company_id, version)
);
create index company_snapshots_company_idx on public.company_snapshots (company_id, captured_at desc);

create table public.company_insights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  snapshot_id uuid not null unique references public.company_snapshots (id) on delete cascade,
  summary text not null,                -- exactly two paragraphs separated by a blank line
  outreach_line text,                   -- null when evidence is insufficient
  outreach_rationale text not null,
  talking_points jsonb not null default '[]'::jsonb,     -- [{point, evidence_ids:[…]}]
  outreach jsonb not null default '{}'::jsonb,          -- {status, referencedIds, needsVerification, insufficientReason, suggestedResearch}
  interpretations jsonb not null default '[]'::jsonb,   -- observation / hypothesis statements
  model text,
  ai_attempts int,
  ai_usage jsonb,
  created_at timestamptz not null default now()
);
create index company_insights_company_idx on public.company_insights (company_id, created_at desc);

alter table public.research_jobs
  add column snapshot_id uuid references public.company_snapshots (id) on delete set null,
  add column run_id uuid references public.refresh_runs (id) on delete set null;

-- ---------------------------------------------------------------- latest state view
create view public.latest_company_state with (security_invoker = true) as
select
  c.*,
  s.id as snapshot_id, s.version, s.captured_at, s.languages, s.recent_languages, s.infra_signals,
  s.activity, s.hiring, s.dns, s.subdomains, s.hn_stories, s.blog_posts, s.web_research,
  s.activity_score, s.fit_score, s.score_breakdown, s.confidence, s.source_status, s.changes,
  i.id as insight_id, i.summary, i.outreach_line, i.outreach_rationale, i.talking_points, i.model
from public.companies c
left join lateral (
  select * from public.company_snapshots s where s.company_id = c.id order by s.captured_at desc limit 1
) s on true
left join public.company_insights i on i.snapshot_id = s.id
where c.is_active;

-- ---------------------------------------------------------------- RLS
alter table public.product_profile enable row level security;
alter table public.refresh_runs enable row level security;
alter table public.company_snapshots enable row level security;
alter table public.company_insights enable row level security;
revoke all on public.latest_company_state from anon, authenticated;

-- ---------------------------------------------------------------- queue functions (is_active)
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
    where c.id = any (p_company_ids) and c.is_active
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

  return jsonb_build_object('batch_id', v_batch, 'queued', v_count, 'requested', coalesce(array_length(p_company_ids, 1), 0));
end $$;

-- Due = active and (never researched, or the weekly refresh is due within the window).
-- Rows added directly in the Supabase table editor are therefore picked up automatically.
create or replace function public.enqueue_due_refreshes(p_window_hours int default 12)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(id) into v_ids
  from public.companies
  where is_active
    and (next_refresh_at is null or next_refresh_at <= now() + make_interval(hours => p_window_hours));

  if v_ids is null then
    return jsonb_build_object('batch_id', null, 'queued', 0, 'requested', 0);
  end if;

  return public.enqueue_research(
    v_ids, 'scheduled', 'Scheduled refresh ' || to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
  );
end $$;

revoke execute on function public.enqueue_research(uuid[], public.job_type, text) from public, anon, authenticated;
revoke execute on function public.enqueue_due_refreshes(int) from public, anon, authenticated;
grant execute on function public.enqueue_research(uuid[], public.job_type, text) to service_role;
grant execute on function public.enqueue_due_refreshes(int) to service_role;
