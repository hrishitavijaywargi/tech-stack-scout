# Tech Stack Scout

AI-powered engineering intelligence for enterprise sales (MESA C4 · Problem Statement 5).

Nikhil keeps a watchlist of target accounts in Supabase. For each company, Tech Stack Scout collects **public, traceable evidence** of how it builds software: the languages in its public code, cloud and infrastructure tooling, architecture signals, and recent engineering activity. **Gemini Flash** then writes a two-paragraph engineering summary and an evidence-based first line for outreach. Research refreshes **every 7 days on the server**, and a *What's Changed?* view highlights new reasons to get in touch.

> Public code, postings and articles show only part of a company's stack. Every report says so, cites its sources and never fills gaps with guesses.

**Live:** https://tech-stack-scout-kappa.vercel.app · **Repo:** https://github.com/hrishitavijaywargi/tech-stack-scout

| Deployment piece | Status |
|---|---|
| Supabase project `tech-stack-scout` (ap-south-1) | Migrations applied; queue functions tested |
| Vercel project `tech-stack-scout` (Git-connected, region `bom1`) | `SUPABASE_URL`, `GEMINI_MODEL`, `CRON_SECRET` set |
| Supabase `pg_cron` job `tech-stack-scout-refresh` (every 10 min) | Active; URL and secret in Vault; call to the app verified |
| Still needed in Vercel env | `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GITHUB_TOKEN` (then redeploy) |

---

## What it does

| Need | How it's met |
|---|---|
| Manage the watchlist without code | Add one company or upload a CSV of 20+ companies in the UI, or edit the `companies` table directly in Supabase. Duplicates are blocked (same name, website or GitHub org). |
| Languages, cloud and infra, activity | GitHub REST API (org repos, language bytes, recursive file trees, dependency manifests, CI workflows, releases, commits) plus Greenhouse / Lever / Ashby job-board APIs, the company's engineering RSS/Atom feed, and Hacker News (Algolia API). |
| No invented facts | A deterministic catalog (`src/lib/research/catalog.ts`) turns files, dependencies and text into findings with source URLs. Gemini receives only those ID'd facts. Its JSON is validated with Zod **and** against the evidence: citations must exist, it can't mention unsupported technologies, and placeholders, generic compliments and "you have a problem" claims are rejected. Invalid answers are retried up to 3 times with the errors fed back. |
| Two-paragraph summary + outreach line | Paragraph 1 covers the environment; paragraph 2 covers activity and relevance, with observations vs. hypotheses marked. The outreach line must name a specific verified finding. If evidence is thin, the report says why and lists the next research steps instead. |
| Confidence | Defined scoring method, not AI-generated: GitHub identification, code coverage, source diversity and recency (25 points each). Unconfirmed matches are capped. |
| Weekly refresh | Supabase `pg_cron` calls `/api/cron/refresh` every 10 minutes, and Vercel Cron calls it weekly as a backup. Each company is refreshed 7 days after its last run. The same pipeline handles manual, bulk and scheduled runs. |
| Bulk research | Jobs are queued in Postgres (one active job per company, claimed with `FOR UPDATE SKIP LOCKED`), run 3 at a time, retried with exponential backoff and paused on rate limits. The UI shows live "12 of 20 companies researched" progress. CSV export is included. |
| What's Changed? | Each run saves a snapshot. The newest snapshot is diffed with the previous one to show newly observed technologies, new postings, releases, new repos, language shifts, activity changes, and items *not re-observed*. That last label is never "stopped using". |

## Architecture

```
Browser (Next.js pages, no DB keys)
   │  fetch /api/*
   ▼
Next.js route handlers (server only) ──► Supabase Postgres (service-role key, RLS on, no public policies)
   │                                         ▲
   │  after() / waitUntil                     │ pg_cron every 10 min ──► GET /api/cron/refresh (Bearer CRON_SECRET)
   ▼                                         │ Vercel Cron Mon 02:00 UTC ─┘
Job processor (src/lib/jobs/queue.ts) — claim_research_jobs() RPC, concurrency 3, retries, rate-limit pause
   ▼
Research pipeline (src/lib/research/pipeline.ts)
   1 identify GitHub org (provided → verified by website link → unconfirmed name match)
   2 GitHub: repos, languages, file trees, manifests, CI workflows, releases, commits (ETag-cached)
   3 Job boards (Greenhouse/Lever/Ashby APIs) · 4 RSS/Atom feed · 5 Hacker News
   6 store sources + findings → aggregate stack (F1…) → confidence score
   7 Gemini Flash (structured JSON) → Zod + evidence validation → retry ≤3
   8 report (versioned) + snapshot + diff vs previous snapshot → company status / next refresh
```

| Module | Path |
|---|---|
| Company management, CSV import/export | `src/lib/companyInput.ts`, `src/lib/data.ts`, `src/app/api/companies/**`, `src/app/api/export` |
| GitHub integration | `src/lib/sources/github.ts` |
| Additional public sources | `src/lib/sources/jobs.ts`, `src/lib/sources/articles.ts` |
| Technology detection | `src/lib/research/catalog.ts` |
| Aggregation, confidence, change tracking | `src/lib/research/analysis.ts` |
| Gemini Flash analysis | `src/lib/ai/gemini.ts`, `src/lib/ai/report.ts` |
| Research pipeline | `src/lib/research/pipeline.ts` |
| Job processing and scheduling | `src/lib/jobs/queue.ts`, `src/app/api/research`, `src/app/api/cron/refresh`, `supabase/scheduler.sql`, `vercel.json` |
| Database | `supabase/migrations/*.sql` |
| Env validation | `src/lib/env.ts` |

Pages: **Dashboard** `/` · **Watchlist** `/watchlist` · **Company report** `/companies/[id]` · **Research activity** `/activity` · **Settings** `/settings`.

## Setup

### 1. Prerequisites
Node 20.9+ (tested on 24), a Supabase project, a Gemini API key, and a GitHub token (recommended).

### 2. Environment variables
Copy `.env.example` to `.env.local` and fill in:

| Variable | Where to get it | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → **secret** key | Server-only. Never prefixed `NEXT_PUBLIC_`. |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | |
| `GEMINI_MODEL` | default `gemini-3.8-flash` | Current stable Flash model per Google's model list (Oct 2026). Change it here only. |
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Fine-grained token, *Public repositories (read-only)* | Raises the limit from 60 to 5,000 requests/hour. One company uses ~20–40 API requests. |
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` | Authenticates scheduler calls. |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | optional | Puts a login prompt in front of the whole app. |

### 3. Database
Run both files in `supabase/migrations/` in order (Supabase SQL editor, or `supabase db push`). They create the tables, indexes, constraints, RLS and the queue functions, and seed one settings row.

Tables: `companies`, `research_jobs`, `research_batches`, `research_sources`, `research_findings`, `research_reports`, `research_snapshots`, `app_settings`, `http_cache`.

### 4. Run locally
```bash
npm install
npm run dev        # http://localhost:3000
```
Locally, research runs in the background of the dev server after each action. The weekly schedule needs the deployed URL (step 6).

### 5. Deploy to Vercel
1. Push the repo to GitHub, then import it in Vercel (framework: Next.js).
2. Add all the environment variables above (Production + Preview).
3. Deploy. `vercel.json` sets the function region (`bom1`), `maxDuration: 300` for API routes, and the weekly Vercel Cron.

### 6. Turn on the weekly refresh
1. Open `supabase/scheduler.sql`, replace `https://YOUR-APP.vercel.app` and `YOUR_CRON_SECRET`, then run it in the Supabase SQL editor. It enables `pg_cron` and `pg_net`, stores both values in Vault, and schedules the job.
2. Check it's working:
   ```sql
   select jobname, schedule, active from cron.job;
   select status_code, content, created from net._http_response order by created desc limit 5;
   ```
   You should see `200` responses like `{"mode":"refresh","queuedNow":0,"pendingJobs":0}`. **Settings → Weekly automatic refresh** shows the last scheduler run.
3. Manual trigger:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/cron/refresh
   ```
   To force a company to be due, run `update companies set next_refresh_at = now() where name = 'X';` and call the endpoint.

## Testing
```bash
npm test               # 40 unit + integration tests (catalog, CSV, confidence, diff, AI validation, GitHub collector with mocked API)
npm run typecheck
npm run build && npm run check:bundle   # fails if any secret name/value/pattern appears in client JS
npx tsx scripts/smoke-github.ts "HashiCorp" hashicorp.com hashicorp 3   # live run of the collectors (no DB / AI)
```
`samples/sprint-20-companies.csv` is a ready-made 20-company list for testing bulk upload.

## Assumptions and limitations
- **Product context:** Nikhil's product isn't named in the brief, so Settings ships with a plausible example ("FlowPilot": CI acceleration, preview environments, service catalog). Replace it there; Gemini uses it for relevance and outreach.
- **Developer talks** aren't collected: there's no reliable public API, and the brief rules out fragile scraping. Every report lists this.
- **Job postings** are read only from Greenhouse, Lever and Ashby public APIs. Other ATSs need a different integration. A guessed board is used only when the board name or postings name the company.
- **Blogs:** only RSS/Atom feeds are read (auto-discovered via `<link rel="alternate">`, or a URL you supply). Some sites block automated requests, and the report says so when that happens.
- **GitHub identification:** a name match is never treated as confirmed. It's labelled *unconfirmed*, the confidence level is capped, and the outreach line is flagged "verify before sending" until you confirm the org.
- **Throughput:** each serverless invocation processes jobs 3 at a time for up to ~270s, then chains another invocation. The dashboard shows *measured* average research time per company and promises no fixed duration.
- **Auth:** single-user app. Enable Basic Auth for a public deployment. The database is not reachable from the browser (RLS on, no anon policies).
