import "server-only";
import { db, check } from "@/lib/supabase/server";
import { findDuplicate, type CompanyInput } from "@/lib/companyInput";
import type { AppSettings, Company, JobType, ResearchJob, ResearchReport } from "@/lib/types";
import type { Snapshot } from "@/lib/research/analysis";
import type { ChangeItem } from "@/lib/types";
import type { HttpCache } from "@/lib/sources/github";

/** Data access for companies, settings, reports, jobs. All server-side (service key). */

// ------------------------------------------------------------------ companies

export async function listCompanies(): Promise<Company[]> {
  return check(await db().from("companies").select("*").order("name"), "Loading companies") as Company[];
}

export async function getCompany(id: string): Promise<Company | null> {
  const res = await db().from("companies").select("*").eq("id", id).maybeSingle();
  return check(res, "Loading company") as Company | null;
}

export async function addCompanies(inputs: CompanyInput[]) {
  const existing = check(await db().from("companies").select("name, domain, github_org"), "Checking duplicates") as Pick<
    CompanyInput,
    "name" | "domain" | "github_org"
  >[];
  const toInsert: CompanyInput[] = [];
  const duplicates: { name: string; reason: string }[] = [];
  for (const c of inputs) {
    const dup = findDuplicate(c, [...existing, ...toInsert]);
    if (dup) duplicates.push({ name: c.name, reason: `Already on the watchlist as "${dup.name}" (same ${dup.matchedOn})` });
    else toInsert.push(c);
  }
  const created: Company[] = [];
  for (const c of toInsert) {
    const res = await db().from("companies").insert(c).select("*").single();
    if (res.error) {
      if (res.error.code === "23505") duplicates.push({ name: c.name, reason: "Already on the watchlist" });
      else throw new Error(`Adding ${c.name} failed: ${res.error.message}`);
    } else created.push(res.data as Company);
  }
  return { created, duplicates };
}

export async function updateCompany(id: string, patch: Partial<Pick<Company, "name" | "domain" | "github_org" | "careers_url" | "blog_url" | "watchlist_status">>) {
  const res = await db().from("companies").update(patch).eq("id", id).select("*").single();
  if (res.error?.code === "23505") throw new Error("Another company on the watchlist already uses that name, website or GitHub organization.");
  return check(res, "Updating company") as Company;
}

export async function deleteCompany(id: string) {
  check(await db().from("companies").delete().eq("id", id), "Removing company");
}

// ------------------------------------------------------------------ settings

export async function getSettings(): Promise<AppSettings> {
  return check(await db().from("app_settings").select("*").eq("id", true).single(), "Loading settings") as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>) {
  return check(await db().from("app_settings").update(patch).eq("id", true).select("*").single(), "Saving settings") as AppSettings;
}

// ------------------------------------------------------------------ reports + snapshots

export async function latestReport(companyId: string): Promise<ResearchReport | null> {
  const res = await db().from("research_reports").select("*").eq("company_id", companyId).order("version", { ascending: false }).limit(1).maybeSingle();
  return check(res, "Loading report") as ResearchReport | null;
}

export async function reportHistory(companyId: string) {
  const res = await db()
    .from("research_snapshots")
    .select("id, report_version, snapshot_at, changes")
    .eq("company_id", companyId)
    .order("snapshot_at", { ascending: false })
    .limit(12);
  return check(res, "Loading history") as { id: string; report_version: number; snapshot_at: string; changes: ChangeItem[] }[];
}

export async function latestSnapshot(companyId: string): Promise<{ id: string; findings: Snapshot } | null> {
  const res = await db().from("research_snapshots").select("id, findings").eq("company_id", companyId).order("snapshot_at", { ascending: false }).limit(1).maybeSingle();
  return check(res, "Loading snapshot") as { id: string; findings: Snapshot } | null;
}

/** Latest report summary per company, for the watchlist table and CSV export. */
export async function latestReportsByCompany() {
  const res = await db()
    .from("research_reports")
    .select("company_id, version, tech_stack, outreach, confidence_level, summary_paragraphs, engineering_activity, created_at")
    .order("version", { ascending: false });
  const rows = check(res, "Loading reports") as Pick<
    ResearchReport,
    "company_id" | "version" | "tech_stack" | "outreach" | "confidence_level" | "summary_paragraphs" | "engineering_activity" | "created_at"
  >[];
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.company_id)) map.set(r.company_id, r);
  return map;
}

// ------------------------------------------------------------------ jobs

export async function recentJobs(limit = 50) {
  const res = await db().from("research_jobs").select("*, companies(name)").order("created_at", { ascending: false }).limit(limit);
  return check(res, "Loading jobs") as (ResearchJob & { companies: { name: string } | null })[];
}

export async function enqueue(companyIds: string[], jobType: JobType, batchLabel: string | null) {
  const res = await db().rpc("enqueue_research", { p_company_ids: companyIds, p_job_type: jobType, p_batch_label: batchLabel });
  return check(res, "Queueing research") as { batch_id: string | null; queued: number; requested: number };
}

export async function retryJob(jobId: string) {
  const res = await db()
    .from("research_jobs")
    .update({ status: "queued", attempts: 0, run_after: new Date().toISOString(), error_code: null, error_message: null, completed_at: null, locked_until: null })
    .eq("id", jobId)
    .eq("status", "failed")
    .select("company_id")
    .maybeSingle();
  if (res.error?.code === "23505") throw new Error("This company already has research queued or running.");
  const row = check(res, "Retrying job") as { company_id: string } | null;
  if (!row) throw new Error("Only failed jobs can be retried.");
  await db().from("companies").update({ research_status: "queued", last_error: null }).eq("id", row.company_id);
}

/** Progress of the most recent batch plus overall queue counts. */
export async function queueProgress() {
  const batchRes = await db().from("research_batches").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const batch = check(batchRes, "Loading batch") as { id: string; label: string; total: number; created_at: string } | null;
  let batchCounts = null as null | { total: number; succeeded: number; failed: number; running: number; queued: number };
  if (batch) {
    const jobs = check(await db().from("research_jobs").select("status").eq("batch_id", batch.id), "Loading batch jobs") as { status: string }[];
    batchCounts = {
      total: jobs.length,
      succeeded: jobs.filter((j) => j.status === "succeeded").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      running: jobs.filter((j) => j.status === "running").length,
      queued: jobs.filter((j) => j.status === "queued").length,
    };
  }
  const active = check(await db().from("research_jobs").select("status").in("status", ["queued", "running"]), "Loading queue") as { status: string }[];
  return {
    batch: batch && batchCounts ? { id: batch.id, label: batch.label, createdAt: batch.created_at, ...batchCounts } : null,
    queued: active.filter((j) => j.status === "queued").length,
    running: active.filter((j) => j.status === "running").length,
  };
}

// ------------------------------------------------------------------ GitHub response cache

export const supabaseHttpCache: HttpCache = {
  async get(url) {
    const res = await db().from("http_cache").select("etag, body, fetched_at").eq("url", url).maybeSingle();
    if (res.error || !res.data) return null;
    // Entries older than 30 days are ignored so the cache can't grow stale indefinitely.
    if (Date.now() - Date.parse(res.data.fetched_at) > 30 * 86_400_000) return null;
    return { etag: res.data.etag, body: res.data.body };
  },
  async set(url, etag, body) {
    await db().from("http_cache").upsert({ url, etag, body, fetched_at: new Date().toISOString() });
  },
};
