import "server-only";
import { db, check } from "@/lib/supabase/server";
import { latestReportsByCompany, listCompanies } from "@/lib/data";
import type { WatchlistRow } from "@/components/WatchlistTable";
import type { ChangeItem, Company, StackItem } from "@/lib/types";

/** Key technologies for the table: top languages by share, then strongest infra/cloud signals. */
export function keyTechnologies(stack: StackItem[]) {
  const langs = stack.filter((s) => s.category === "language" && (s.share ?? 0) >= 0.05).slice(0, 3);
  const rest = stack.filter((s) => s.category === "cloud" || s.category === "infrastructure" || s.category === "framework").filter((s) => s.strongestKind === "code");
  const fallback = stack.filter((s) => !langs.includes(s) && !rest.includes(s));
  return [...langs, ...rest, ...fallback].slice(0, 6).map((s) => s.technology);
}

export async function watchlistRows(): Promise<{ rows: WatchlistRow[]; companies: Company[] }> {
  const [companies, reports] = await Promise.all([listCompanies(), latestReportsByCompany()]);
  const rows = companies.map((c) => {
    const r = reports.get(c.id);
    return {
      id: c.id,
      name: c.name,
      domain: c.domain,
      status: c.research_status,
      keyTech: r ? keyTechnologies(r.tech_stack as StackItem[]) : [],
      lastResearchedAt: c.last_researched_at,
      nextRefreshAt: c.watchlist_status === "active" ? c.next_refresh_at : null,
      confidence: r?.confidence_level ?? null,
      lastError: c.last_error,
      githubOrg: c.github_org ?? c.detected_github_org,
      githubUnconfirmed: !c.github_org && c.detected_github_org_method === "name_match_unconfirmed",
      paused: c.watchlist_status === "paused",
    } satisfies WatchlistRow;
  });
  return { rows, companies };
}

export async function dashboardData() {
  const { rows, companies } = await watchlistRows();
  const [jobsRes, changesRes, durRes] = await Promise.all([
    db().from("research_jobs").select("id, status, job_type, created_at, completed_at, error_message, company_id, companies(name)").order("updated_at", { ascending: false }).limit(8),
    db().from("research_snapshots").select("company_id, snapshot_at, changes, companies(name)").order("snapshot_at", { ascending: false }).limit(40),
    db().from("research_jobs").select("started_at, completed_at").eq("status", "succeeded").not("started_at", "is", null).order("completed_at", { ascending: false }).limit(50),
  ]);
  const jobs = check(jobsRes, "Loading activity") as unknown as {
    id: string;
    status: string;
    job_type: string;
    created_at: string;
    completed_at: string | null;
    error_message: string | null;
    company_id: string;
    companies: { name: string } | null;
  }[];
  const snaps = check(changesRes, "Loading changes") as unknown as { company_id: string; snapshot_at: string; changes: ChangeItem[]; companies: { name: string } | null }[];
  const seen = new Set<string>();
  const changes = snaps
    .filter((s) => !seen.has(s.company_id) && seen.add(s.company_id))
    .flatMap((s) => s.changes.filter((c) => c.kind !== "not_reobserved").map((c) => ({ ...c, companyId: s.company_id, companyName: s.companies?.name ?? "", snapshotAt: s.snapshot_at })))
    .slice(0, 8);
  const durations = (check(durRes, "Loading durations") as { started_at: string; completed_at: string }[])
    .map((j) => Date.parse(j.completed_at) - Date.parse(j.started_at))
    .filter((d) => d > 0);
  const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  return { rows, companies, jobs, changes, avgMs, measuredJobs: durations.length };
}
