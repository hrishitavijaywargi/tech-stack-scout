import "server-only";
import { db, check } from "@/lib/supabase/server";
import { findDuplicate, type CompanyInput } from "@/lib/companyInput";
import type { HttpCache } from "@/lib/collectors/github";
import type { AppSettings, Company, CompanyInsight, CompanySnapshot, JobType, ProductProfile, RefreshRun, ResearchJob } from "@/lib/types";

/** Data access (server only, secret key). */

// ------------------------------------------------------------------ companies

export async function listCompanies({ includeInactive = false } = {}): Promise<Company[]> {
  let q = db().from("companies").select("*").order("name");
  if (!includeInactive) q = q.eq("is_active", true);
  return check(await q, "Loading companies") as Company[];
}

export async function getCompany(id: string): Promise<Company | null> {
  return check(await db().from("companies").select("*").eq("id", id).maybeSingle(), "Loading company") as Company | null;
}

export async function addCompanies(inputs: CompanyInput[]) {
  const existing = check(await db().from("companies").select("id, name, domain, github_org, is_active"), "Checking duplicates") as (Pick<CompanyInput, "name" | "domain" | "github_org"> & {
    id: string;
    is_active: boolean;
  })[];
  const toInsert: CompanyInput[] = [];
  const duplicates: { name: string; reason: string }[] = [];
  const reactivated: Company[] = [];
  for (const c of inputs) {
    const dup = findDuplicate(c, [...existing, ...toInsert]);
    const row = dup ? existing.find((e) => e.name === dup.name) : null;
    if (row && !row.is_active) {
      // Re-adding a removed company reactivates it (keeps its history).
      const res = await db().from("companies").update({ is_active: true }).eq("id", row.id).select("*").single();
      reactivated.push(check(res, "Reactivating company") as Company);
    } else if (dup) duplicates.push({ name: c.name, reason: `Already on the watchlist as "${dup.name}" (same ${dup.matchedOn})` });
    else toInsert.push(c);
  }
  const created: Company[] = [...reactivated];
  for (const c of toInsert) {
    const res = await db().from("companies").insert(c).select("*").single();
    if (res.error) {
      if (res.error.code === "23505") duplicates.push({ name: c.name, reason: "Already on the watchlist" });
      else throw new Error(`Adding ${c.name} failed: ${res.error.message}`);
    } else created.push(res.data as Company);
  }
  return { created, duplicates };
}

export type CompanyPatch = Partial<Pick<Company, "name" | "domain" | "github_org" | "job_board_provider" | "job_board_slug" | "blog_rss_url" | "notes" | "is_active">>;

export async function updateCompany(id: string, patch: CompanyPatch) {
  const res = await db().from("companies").update(patch).eq("id", id).select("*").single();
  if (res.error?.code === "23505") throw new Error("Another company on the watchlist already uses that name, domain or GitHub organization.");
  return check(res, "Updating company") as Company;
}

export async function deleteCompany(id: string) {
  check(await db().from("companies").delete().eq("id", id), "Deleting company");
}

// ------------------------------------------------------------------ settings + product profile

export async function getSettings(): Promise<AppSettings> {
  return check(await db().from("app_settings").select("*").eq("id", true).single(), "Loading settings") as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>) {
  return check(await db().from("app_settings").update(patch).eq("id", true).select("*").single(), "Saving settings") as AppSettings;
}

export async function getProductProfile(): Promise<ProductProfile> {
  return check(await db().from("product_profile").select("*").eq("id", true).single(), "Loading product profile") as ProductProfile;
}

export async function updateProductProfile(patch: Partial<ProductProfile>) {
  return check(await db().from("product_profile").update(patch).eq("id", true).select("*").single(), "Saving product profile") as ProductProfile;
}

// ------------------------------------------------------------------ snapshots + insights

export async function latestSnapshot(companyId: string): Promise<CompanySnapshot | null> {
  const res = await db().from("company_snapshots").select("*").eq("company_id", companyId).order("captured_at", { ascending: false }).limit(1).maybeSingle();
  return check(res, "Loading snapshot") as CompanySnapshot | null;
}

export async function insightFor(snapshotId: string): Promise<CompanyInsight | null> {
  return check(await db().from("company_insights").select("*").eq("snapshot_id", snapshotId).maybeSingle(), "Loading insight") as CompanyInsight | null;
}

/** Light history for trends: one row per snapshot, newest first. */
export async function snapshotHistory(companyId: string, limit = 12) {
  const res = await db()
    .from("company_snapshots")
    .select("id, version, captured_at, activity_score, fit_score, recent_languages, hiring->eng_open_roles, activity->commits_90d, changes")
    .eq("company_id", companyId)
    .order("captured_at", { ascending: false })
    .limit(limit);
  return check(res, "Loading history") as unknown as {
    id: string;
    version: number;
    captured_at: string;
    activity_score: number;
    fit_score: number;
    recent_languages: CompanySnapshot["recent_languages"];
    eng_open_roles: number | null;
    commits_90d: number | null;
    changes: CompanySnapshot["changes"];
  }[];
}

/** Row shape of the latest_company_state view used by the watchlist and CSV export. */
export interface LatestState extends Company {
  snapshot_id: string | null;
  version: number | null;
  captured_at: string | null;
  languages: CompanySnapshot["languages"] | null;
  recent_languages: CompanySnapshot["recent_languages"] | null;
  infra_signals: CompanySnapshot["infra_signals"] | null;
  activity: CompanySnapshot["activity"] | null;
  hiring: CompanySnapshot["hiring"] | null;
  dns: CompanySnapshot["dns"] | null;
  activity_score: number | null;
  fit_score: number | null;
  score_breakdown: CompanySnapshot["score_breakdown"] | null;
  confidence: CompanySnapshot["confidence"] | null;
  source_status: CompanySnapshot["source_status"] | null;
  changes: CompanySnapshot["changes"] | null;
  summary: string | null;
  outreach_line: string | null;
  outreach_rationale: string | null;
}

export async function latestStates(): Promise<LatestState[]> {
  return check(await db().from("latest_company_state").select("*").order("name"), "Loading watchlist") as LatestState[];
}

// ------------------------------------------------------------------ jobs + runs

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

export async function recentRuns(limit = 20): Promise<RefreshRun[]> {
  return check(await db().from("refresh_runs").select("*").order("started_at", { ascending: false }).limit(limit), "Loading refresh runs") as RefreshRun[];
}

export async function startRun(trigger: "cron" | "manual", source: string, queued: number): Promise<string> {
  const res = await db().from("refresh_runs").insert({ trigger, source, companies_queued: queued }).select("id").single();
  return (check(res, "Starting refresh run") as { id: string }).id;
}

export async function finishRun(id: string, processed: number, errors: { company: string; message: string }[], stoppedReason: string) {
  const status = processed === 0 && errors.length === 0 ? "idle" : errors.length === 0 ? "succeeded" : processed > 0 ? "partial" : "failed";
  await db().from("refresh_runs").update({ finished_at: new Date().toISOString(), companies_processed: processed, errors, status }).eq("id", id);
  return { status, stoppedReason };
}

/** Progress of the most recent batch plus overall queue counts. */
export async function queueProgress() {
  const batch = check(await db().from("research_batches").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(), "Loading batch") as {
    id: string;
    label: string;
    total: number;
    created_at: string;
  } | null;
  let counts = null as null | { total: number; succeeded: number; failed: number; running: number; queued: number };
  if (batch) {
    const jobs = check(await db().from("research_jobs").select("status").eq("batch_id", batch.id), "Loading batch jobs") as { status: string }[];
    counts = {
      total: jobs.length,
      succeeded: jobs.filter((j) => j.status === "succeeded").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      running: jobs.filter((j) => j.status === "running").length,
      queued: jobs.filter((j) => j.status === "queued").length,
    };
  }
  const active = check(await db().from("research_jobs").select("status").in("status", ["queued", "running"]), "Loading queue") as { status: string }[];
  return {
    batch: batch && counts ? { id: batch.id, label: batch.label, createdAt: batch.created_at, ...counts } : null,
    queued: active.filter((j) => j.status === "queued").length,
    running: active.filter((j) => j.status === "running").length,
  };
}

// ------------------------------------------------------------------ GitHub response cache

export const supabaseHttpCache: HttpCache = {
  async get(url) {
    const res = await db().from("http_cache").select("etag, body, fetched_at").eq("url", url).maybeSingle();
    if (res.error || !res.data) return null;
    if (Date.now() - Date.parse(res.data.fetched_at) > 30 * 86_400_000) return null;
    return { etag: res.data.etag, body: res.data.body };
  },
  async set(url, etag, body) {
    await db().from("http_cache").upsert({ url, etag, body, fetched_at: new Date().toISOString() });
  },
};
