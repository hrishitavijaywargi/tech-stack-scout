import "server-only";
import { db, check } from "@/lib/supabase/server";
import { ConfigError } from "@/lib/env";
import { HttpError, RateLimitError } from "@/lib/http";
import { finishRun, getSettings, startRun } from "@/lib/data";
import { PermanentError, runResearch } from "@/lib/research/pipeline";
import type { ResearchJob } from "@/lib/types";

/**
 * Job processor shared by every trigger (UI actions, Vercel Cron, Supabase pg_cron). Each
 * invocation is a refresh_runs row. Jobs are claimed atomically in Postgres (FOR UPDATE SKIP
 * LOCKED), run 4 at a time, retried with exponential backoff, and paused on rate limits. It only
 * starts a job if it can finish inside the function's time limit, then stops (~80% budget).
 */

// A job must finish inside one serverless invocation (maxDuration 300 s).
const JOB_TIMEOUT_MS = 240_000;

export function explainError(err: unknown): { code: string; message: string } {
  if (err instanceof RateLimitError) return { code: "rate_limited", message: `${err.service} rate limit reached. Will resume after ${err.resetAt.toISOString().slice(11, 16)} UTC.` };
  if (err instanceof ConfigError) return { code: "config", message: err.message };
  if (err instanceof PermanentError) return { code: "permanent", message: err.message };
  if (err instanceof HttpError) {
    if (err.url.includes("generativelanguage")) return { code: "ai_error", message: `Gemini request failed: ${err.message}` };
    return { code: "source_error", message: err.message };
  }
  const msg = (err as Error)?.message ?? String(err);
  if (/validation/i.test(msg)) return { code: "ai_validation", message: msg };
  if (/timed out/i.test(msg)) return { code: "timeout", message: msg };
  return { code: "error", message: msg.slice(0, 500) };
}

async function claim(limit: number): Promise<ResearchJob[]> {
  return check(await db().rpc("claim_research_jobs", { p_limit: limit, p_lock_seconds: 480 }), "Claiming jobs") as ResearchJob[];
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Research timed out after ${ms / 1000}s`)), ms))]);
}

async function handleFailure(job: ResearchJob, err: unknown, refreshDays: number) {
  const { code, message } = explainError(err);
  const nowMs = Date.now();
  console.error(`[queue] job ${job.id.slice(0, 8)} failed (${code}): ${message}`);

  if (err instanceof RateLimitError) {
    // Not the job's fault: put it back without consuming an attempt, and hold the whole queue
    // until the reset (the limit is shared by every job).
    const runAfter = new Date(err.resetAt.getTime() + 5000).toISOString();
    await db()
      .from("research_jobs")
      .update({ status: "queued", attempts: Math.max(0, job.attempts - 1), run_after: runAfter, locked_until: null, error_code: code, error_message: message })
      .eq("id", job.id);
    await db().from("companies").update({ research_status: "queued", last_error: message }).eq("id", job.company_id);
    await db().from("research_jobs").update({ run_after: runAfter, error_code: code, error_message: `Waiting: ${message}` }).eq("status", "queued").lt("run_after", err.resetAt.toISOString());
    return;
  }

  const final = err instanceof ConfigError || err instanceof PermanentError || job.attempts >= job.max_attempts;
  if (!final) {
    const delayMin = 2 ** job.attempts; // 2, 4, 8… minutes
    await db()
      .from("research_jobs")
      .update({ status: "queued", run_after: new Date(nowMs + delayMin * 60_000).toISOString(), locked_until: null, error_code: code, error_message: `${message} (retrying in ${delayMin} min)` })
      .eq("id", job.id);
    await db().from("companies").update({ research_status: "queued", last_error: message }).eq("id", job.company_id);
    return;
  }
  await db().from("research_jobs").update({ status: "failed", completed_at: new Date().toISOString(), locked_until: null, error_code: code, error_message: message }).eq("id", job.id);
  await db()
    .from("companies")
    .update({ research_status: "failed", last_error: message, next_refresh_at: new Date(nowMs + refreshDays * 86_400_000).toISOString() })
    .eq("id", job.company_id);
}

export interface ProcessResult {
  runId: string;
  claimed: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  stoppedReason: string;
}

export async function processQueue({
  trigger = "manual",
  source = "ui",
  budgetMs = 280_000,
  concurrency = 4,
}: { trigger?: "cron" | "manual"; source?: string; budgetMs?: number; concurrency?: number } = {}): Promise<ProcessResult> {
  const start = Date.now();
  const deadline = start + budgetMs;
  const settings = await getSettings();
  const { count: queuedCount } = await db().from("research_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lte("run_after", new Date().toISOString());
  const { count: staleRunning } = await db().from("research_jobs").select("id", { count: "exact", head: true }).eq("status", "running").lt("locked_until", new Date().toISOString());
  // Idle scheduler ticks (every 10 min) don't create refresh_runs rows.
  if (!queuedCount && !staleRunning) return { runId: "", claimed: 0, succeeded: 0, failed: 0, durationMs: Date.now() - start, stoppedReason: "nothing to do" };
  const runId = await startRun(trigger, source, (queuedCount ?? 0) + (staleRunning ?? 0));
  const result: ProcessResult = { runId, claimed: 0, succeeded: 0, failed: 0, durationMs: 0, stoppedReason: "queue empty" };
  const errors: { company: string; message: string }[] = [];
  let rateLimited = false;
  const running = new Set<Promise<void>>();

  const companyName = async (id: string) => ((await db().from("companies").select("name").eq("id", id).maybeSingle()).data?.name as string | undefined) ?? id;

  const runOne = async (job: ResearchJob) => {
    await db().from("research_jobs").update({ run_id: runId }).eq("id", job.id);
    try {
      const { snapshotId } = await withTimeout(runResearch({ ...job, run_id: runId }, Date.now() + JOB_TIMEOUT_MS), JOB_TIMEOUT_MS + 15_000);
      await db().from("research_jobs").update({ status: "succeeded", completed_at: new Date().toISOString(), locked_until: null, snapshot_id: snapshotId, error_code: null, error_message: null }).eq("id", job.id);
      result.succeeded++;
    } catch (err) {
      if (err instanceof RateLimitError) rateLimited = true;
      result.failed++;
      errors.push({ company: await companyName(job.company_id), message: explainError(err).message });
      await handleFailure(job, err, settings.refresh_interval_days).catch((e) => console.error("[queue] could not record failure", e));
    }
  };

  for (;;) {
    if (rateLimited) {
      result.stoppedReason = "rate limited";
      break;
    }
    if (deadline - Date.now() < JOB_TIMEOUT_MS) {
      result.stoppedReason = "time budget reached";
      break;
    }
    const slots = concurrency - running.size;
    if (slots > 0) {
      const jobs = await claim(slots);
      result.claimed += jobs.length;
      for (const job of jobs) {
        const p: Promise<void> = runOne(job).finally(() => running.delete(p));
        running.add(p);
      }
      if (!jobs.length) {
        if (!running.size) break;
        await Promise.race(running);
      }
    } else await Promise.race(running);
  }
  await Promise.allSettled([...running]);
  result.durationMs = Date.now() - start;
  await finishRun(runId, result.succeeded, errors, result.stoppedReason);
  return result;
}
