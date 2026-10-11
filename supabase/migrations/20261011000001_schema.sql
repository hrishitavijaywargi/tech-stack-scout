-- Tech Stack Scout — core schema
-- All tables have RLS enabled with no anon/authenticated policies: the browser never
-- talks to Supabase directly. The Next.js server uses the secret (service-role) key.

create type public.research_status as enum ('not_started', 'queued', 'researching', 'completed', 'failed');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
create type public.job_type as enum ('initial', 'manual', 'bulk', 'scheduled');
create type public.finding_category as enum ('language', 'framework', 'cloud', 'infrastructure', 'architecture');
create type public.source_type as enum (
  'github_org', 'github_repo', 'github_release', 'job_posting', 'engineering_blog', 'hacker_news'
);

-- ---------------------------------------------------------------- companies
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  domain text check (domain is null or domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  -- GitHub org supplied or confirmed by the user (trusted)
  github_org text check (github_org is null or github_org ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
  -- GitHub org the research pipeline matched on its own, and how
  detected_github_org text,
  detected_github_org_method text check (detected_github_org_method in ('user_provided', 'verified_domain', 'name_match_unconfirmed')),
  careers_url text,
  blog_url text,
  watchlist_status text not null default 'active' check (watchlist_status in ('active', 'paused')),
  research_status public.research_status not null default 'not_started',
  last_researched_at timestamptz,
  next_refresh_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_name_key_uq on public.companies (name_key);
create unique index companies_domain_uq on public.companies (domain) where domain is not null;
create unique index companies_github_org_uq on public.companies (lower(github_org)) where github_org is not null;
create index companies_next_refresh_idx on public.companies (next_refresh_at) where watchlist_status = 'active';

-- ---------------------------------------------------------------- batches + jobs
create table public.research_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  job_type public.job_type not null,
  total int not null default 0 check (total >= 0),
  created_at timestamptz not null default now()
);

create table public.research_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid references public.research_batches (id) on delete set null,
  job_type public.job_type not null,
  status public.job_status not null default 'queued',
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  report_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotency: at most one queued/running job per company.
create unique index research_jobs_one_active_uq on public.research_jobs (company_id) where status in ('queued', 'running');
create index research_jobs_claim_idx on public.research_jobs (status, run_after);
create index research_jobs_company_idx on public.research_jobs (company_id, created_at desc);
create index research_jobs_batch_idx on public.research_jobs (batch_id);

-- ---------------------------------------------------------------- sources + findings
create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  url text not null,
  source_type public.source_type not null,
  title text,
  published_at timestamptz,           -- date of the underlying artefact (push, release, posting, article)
  first_collected_at timestamptz not null default now(),
  last_collected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (company_id, url)
);
create index research_sources_company_idx on public.research_sources (company_id, source_type);

create table public.research_findings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  source_id uuid not null references public.research_sources (id) on delete cascade,
  technology text not null,
  category public.finding_category not null,
  evidence_kind text not null check (evidence_kind in ('code', 'repo_language', 'job_posting', 'article')),
  evidence text not null,
  detail jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_job_id uuid references public.research_jobs (id) on delete set null,
  unique (company_id, source_id, technology)
);
create index research_findings_company_idx on public.research_findings (company_id, category);

-- ---------------------------------------------------------------- reports + snapshots
create table public.research_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  job_id uuid references public.research_jobs (id) on delete set null,
  version int not null check (version > 0),
  summary_paragraphs text[] not null check (array_length(summary_paragraphs, 1) = 2),
  tech_stack jsonb not null,
  engineering_activity jsonb not null,
  outreach jsonb not null,
  interpretations jsonb not null default '[]'::jsonb,
  evidence_facts jsonb not null default '[]'::jsonb,  -- the exact ID'd fact list Gemini was given (F1, R1, J1…)
  confidence_level text not null check (confidence_level in ('High', 'Medium', 'Low')),
  confidence_score int not null check (confidence_score between 0 and 100),
  confidence_breakdown jsonb not null,
  limitations text[] not null default '{}',
  missing_information text[] not null default '{}',
  source_statuses jsonb not null default '[]'::jsonb,
  sources_analyzed int not null default 0,
  github_identification jsonb not null default '{}'::jsonb,
  ai_model text,
  ai_attempts int,
  ai_usage jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, version)
);
create index research_reports_company_idx on public.research_reports (company_id, version desc);

alter table public.research_jobs
  add constraint research_jobs_report_fk foreign key (report_id) references public.research_reports (id) on delete set null;

create table public.research_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  report_id uuid not null unique references public.research_reports (id) on delete cascade,
  report_version int not null,
  previous_snapshot_id uuid references public.research_snapshots (id) on delete set null,
  snapshot_at timestamptz not null default now(),
  findings jsonb not null,             -- normalised technology set + languages + releases + jobs + activity
  changes jsonb not null default '[]'::jsonb
);
create index research_snapshots_company_idx on public.research_snapshots (company_id, snapshot_at desc);

-- ---------------------------------------------------------------- settings + cache
create table public.app_settings (
  id boolean primary key default true check (id),
  product_name text not null,
  product_description text not null,
  refresh_interval_days int not null default 7 check (refresh_interval_days between 1 and 60),
  max_repos int not null default 10 check (max_repos between 3 and 25),
  include_job_boards boolean not null default true,
  include_blogs boolean not null default true,
  include_hacker_news boolean not null default true,
  last_scheduler_run_at timestamptz,
  last_scheduler_result jsonb,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (product_name, product_description) values (
  'FlowPilot',
  'A developer productivity platform for engineering teams running many services in the cloud. '
  || 'It speeds up CI pipelines with remote build caching and test-impact analysis, spins up ephemeral '
  || 'preview environments on Kubernetes for every pull request, and gives teams a service catalog with '
  || 'ownership and dependency maps across microservices. Strongest fit: teams on AWS, GCP or Azure using '
  || 'Kubernetes/Docker, GitHub Actions or other CI, and polyglot codebases (Go, TypeScript, Java/Kotlin, Python).'
);

-- Conditional-request cache for GitHub API responses (ETag → 304 responses do not count
-- against the GitHub rate limit).
create table public.http_cache (
  url text primary key,
  etag text,
  body jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- updated_at trigger
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
create trigger research_jobs_touch before update on public.research_jobs
  for each row execute function public.touch_updated_at();
create trigger app_settings_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS (deny by default)
alter table public.companies enable row level security;
alter table public.research_batches enable row level security;
alter table public.research_jobs enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_findings enable row level security;
alter table public.research_reports enable row level security;
alter table public.research_snapshots enable row level security;
alter table public.app_settings enable row level security;
alter table public.http_cache enable row level security;
