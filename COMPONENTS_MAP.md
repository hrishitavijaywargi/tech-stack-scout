# Components Map — Trigger → Input → Context → Processing → AI → Output

*Tech Stack Scout: engineering intelligence for Nikhil's target-account watchlist. File references point to the implementation.*

```
┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐   ┌────────────────────┐   ┌───────────────┐   ┌────────────────────┐
│   TRIGGER    │──►│      INPUT       │──►│     CONTEXT      │──►│     PROCESSING     │──►│      AI       │──►│       OUTPUT       │
│ weekly cron  │   │ watchlist row    │   │ product profile  │   │ identify org →     │   │ Gemini Flash: │   │ report v(n): stack,│
│ (pg_cron +   │   │ (name, website,  │   │ previous snapshot│   │ collect → detect → │   │ 2-para summary│   │ activity, evidence,│
│ Vercel Cron) │   │ GitHub, careers, │   │ first-observed   │   │ aggregate → score  │   │ + outreach    │   │ confidence, outreach│
│ add / CSV /  │   │ blog) + live     │   │ dates · settings │   │ → validate AI →    │   │ (validated,   │   │ What's Changed,    │
│ Research All │   │ public sources   │   │ ETag cache       │   │ snapshot + diff    │   │ never decides)│   │ CSV export         │
└──────────────┘   └──────────────────┘   └──────────────────┘   └────────────────────┘   └───────────────┘   └────────────────────┘
```

## 1. Trigger
| Component | Implementation | Notes |
|---|---|---|
| Weekly refresh | Supabase `pg_cron` every 10 min → `GET /api/cron/refresh` (`supabase/scheduler.sql`) | Queues companies whose `next_refresh_at` (last run + 7 days) is due. Runs with nobody using the app. |
| Backup scheduler | Vercel Cron `0 2 * * 1` → same endpoint (`vercel.json`) | Bearer `CRON_SECRET`, compared in constant time. |
| Add company | `POST /api/companies` | Queues an `initial` job. |
| Bulk / CSV | `POST /api/companies/import` | Validates rows and queues one batch. Progress reads "x of N researched". |
| Manual | Refresh, Retry, Research All, Needs-attention buttons → `POST /api/research`, `POST /api/jobs/[id]/retry` | Idempotent: one queued/running job per company (partial unique index). |

## 2. Input
| Input | Source | Handling |
|---|---|---|
| Watchlist | `companies` table (UI or Supabase table editor) | Zod-validated and normalized (domain, GitHub login, URLs). Duplicates blocked on name, domain and GitHub org. |
| Public code | GitHub REST: org profile, repos (≤200), languages, recursive trees, manifests via raw.githubusercontent, CI workflows, releases, commits | ETag conditional requests cached in `http_cache`. Rate limits raise `RateLimitError` → job paused until reset. |
| Job postings | Greenhouse / Lever / Ashby public JSON APIs | Guessed boards accepted only if they name the company. Engineering roles only. |
| Articles | Company RSS/Atom feed (auto-discovered), Hacker News Algolia API (stories on the company's domain) | No HTML scraping. Blocked sites are reported as such. |
| Talks | — | Not collected (no reliable API). Listed as a limitation on every report. |

## 3. Context
| Context | Where | Used for |
|---|---|---|
| Nikhil's product profile | `app_settings.product_name/description` (Settings page) | Relevance paragraph and outreach line |
| Previous snapshot | `research_snapshots` | What's Changed diff |
| First-observed dates | `research_findings.first_observed_at` | "First observed by Tech Stack Scout" per technology |
| Research preferences | `app_settings` (refresh days, repos analyzed, source toggles) | Pipeline depth and schedule |
| Technology catalog | `src/lib/research/catalog.ts` | Deterministic mapping from files, dependencies and text to technologies |

## 4. Processing (deterministic, `src/lib/research/pipeline.ts`)
1. **Identify** the GitHub org: user-provided → verified (org profile links to company domain) → *unconfirmed* name match → none.
2. **Collect** evidence from every source. Each finding = technology + category + evidence kind (code / language stats / job posting / article) + source URL + date.
3. **Store** `research_sources` and `research_findings` (upserts keep first/last observed).
4. **Aggregate** into a stack with IDs F1…Fn (`analysis.ts → buildStack`).
5. **Score confidence** with a defined method (identification, coverage, diversity, recency; 25 points each; caps).
6. **Prompt** Gemini with only the ID'd facts (F, R, N, M, J, A).
7. **Validate** the answer: Zod schema; citations exist; no technology outside the evidence (negated or product sentences allowed); outreach must name a referenced finding, with no placeholders, generic compliments or problem claims. Up to 3 attempts.
8. **Save** a versioned report + snapshot, **diff** it against the previous snapshot, and set `next_refresh_at`.

## 5. AI (constrained)
| Job | Model | Guardrails |
|---|---|---|
| Two-paragraph engineering summary | Gemini Flash (`GEMINI_MODEL` default `gemini-3.6-flash`, fallback `gemini-3.8-flash`), structured JSON output | Evidence-only, cited IDs, observation vs. hypothesis labelled |
| Outreach opening | Same call | Must reference a verified finding by name. Flagged "verify" on unconfirmed orgs. With no evidence, Gemini isn't called and the report says why. |
| Not done by AI | — | Technology detection, confidence score, change tracking, activity level |

## 6. Output
| Output | Where |
|---|---|
| Company Intelligence Report: outreach line, summary, observations/hypotheses, categorized stack with evidence links and dates, activity, What's Changed, evidence & confidence, limitations | `/companies/[id]` |
| Watchlist table (status, key technologies, confidence, last/next research) | `/watchlist` |
| Dashboard: totals, needs attention, latest changes, latest jobs, measured avg. research time | `/` |
| Research Activity: jobs, attempts, durations, explained errors, retry | `/activity` |
| CSV export of all reports | `GET /api/export` |
