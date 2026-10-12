import "server-only";
import { latestStates, recentRuns, type LatestState } from "@/lib/data";
import type { ResearchStatus, StackItem } from "@/lib/types";

export interface WatchlistRow {
  id: string;
  name: string;
  domain: string;
  status: ResearchStatus;
  languages: { name: string; pct: number; color: string | null }[];
  primaryCloud: string | null;
  clouds: string[];
  activityScore: number | null;
  commits52w: number[];
  fitScore: number | null;
  engRoles: number | null;
  prevEngRoles: number | null;
  lastRefreshed: string | null;
  nextRefresh: string | null;
  stale: boolean;
  confidence: "High" | "Medium" | "Low" | null;
  hasOutreach: boolean;
  outreachLine: string | null;
  githubLogin: string | null;
  /** Fresh signal from the latest snapshot that gives a reason to reach out now. */
  whyNow: { title: string; count: number } | null;
  githubUnconfirmed: boolean;
  lastError: string | null;
}

const STALE_MS = 7 * 86_400_000;
const CONF = { high: 3, medium: 2, low: 1 } as const;

export function toRow(c: LatestState): WatchlistRow {
  const langs = (c.recent_languages?.length ? c.recent_languages : c.languages) ?? [];
  const clouds = ((c.infra_signals ?? []) as StackItem[])
    .filter((s) => s.category === "cloud" && !["Vercel", "Netlify", "Fastly", "Akamai", "Firebase", "Supabase", "Heroku", "Fly.io"].includes(s.tech))
    .sort((a, b) => CONF[b.confidence] - CONF[a.confidence] || b.evidenceCount - a.evidenceCount);
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    status: c.research_status,
    languages: langs.slice(0, 3).map((l) => ({ name: l.name, pct: l.pct, color: l.color })),
    primaryCloud: clouds[0]?.tech ?? null,
    clouds: clouds.map((s) => s.tech),
    activityScore: c.activity_score,
    commits52w: c.activity?.commits_52w ?? [],
    fitScore: c.fit_score,
    engRoles: c.hiring?.provider ? c.hiring.eng_open_roles : null,
    prevEngRoles: c.hiring?.previous_eng_open_roles ?? null,
    lastRefreshed: c.captured_at,
    nextRefresh: c.next_refresh_at,
    stale: !c.captured_at || Date.now() - Date.parse(c.captured_at) > STALE_MS,
    confidence: c.confidence?.level ?? null,
    hasOutreach: Boolean(c.outreach_line),
    outreachLine: c.outreach_line,
    githubLogin: c.github_org ?? c.detected_github_org,
    whyNow: whyNow(c),
    githubUnconfirmed: !c.github_org && c.detected_github_org_method === "name_match_unconfirmed",
    lastError: c.last_error,
  };
}

const HOT_KINDS = new Set(["new_technology", "new_job_posting", "hiring_change", "new_release", "new_repository", "new_language"]);

/** "New reason to reach out": meaningful changes in a snapshot captured in the last 7 days. */
function whyNow(c: LatestState): WatchlistRow["whyNow"] {
  if (!c.captured_at || Date.now() - Date.parse(c.captured_at) > STALE_MS) return null;
  const hot = (c.changes ?? []).filter((x) => HOT_KINDS.has(x.kind));
  if (!hot.length) return null;
  const order = ["hiring_change", "new_job_posting", "new_release", "new_technology", "new_language", "new_repository"];
  hot.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return { title: hot[0].title, count: hot.length };
}

/** Next run of a "minute hour * * dow" UTC cron expression (dow optional). */
export function nextCron(minute: number, hour: number, dow: number | null, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), hour, minute));
  while (d <= from || (dow !== null && d.getUTCDay() !== dow)) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export async function watchlistData() {
  const [states, runs] = await Promise.all([latestStates(), recentRuns(1)]);
  return {
    rows: states.map(toRow),
    lastRun: runs[0] ?? null,
    nextWeekly: nextCron(0, 6, 1),
    nextDaily: nextCron(0, 7, null),
  };
}
