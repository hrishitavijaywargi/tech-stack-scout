import "server-only";
import { db, check } from "@/lib/supabase/server";
import { ConfigError } from "@/lib/env";
import { HttpError, RateLimitError } from "@/lib/http";
import { getSettings } from "@/lib/data";
import { PermanentError, runResearch } from "@/lib/research/pipeline";
import type { ResearchJob } from "@/lib/types";

/**
 * Job processor shared by every trigger (UI actions, Supabase pg_cron, Vercel Cron).
 * Jobs are claimed atomically in Postgres (FOR UPDATE SKIP LOCKED), run with a fixed
 * concurrency limit, retried with exponential backoff, and paused on rate limits.
 */

// A job must finish inside one serverless invocation (maxDuration 300s).
const JOB_TIMEOUT_MS = 150_000;

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
  const res = await db().rpc("claim_research_jobs", { p_limit: limit, p_lock_seconds: 480 });
  return check(res, "Claiming jobs") as ResearchJob[];
}

function withTimeout<T>(p: Promise<T>, ms: number) {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Research timed out after ${ms / 1000}s`)), ms))]);
}

async function handleFailure(job: ResearchJob, err: unknown, refreshDays: number) {
  const { code, message } = explainError(err);
  const nowMs = Date.now();
  console.error(`[queue] job ${job.id.slice(0, 8)} failed (${code}): ${message}`);

  if (err instanceof RateLimitError) {
    // Not the job's fault: put it back without consuming an attempt.
    await db()
      .from("research_jobs")
      .update({ status: "queued", attempts: Math.max(0, job.attempts - 1), run_after: new Date(err.resetAt.getTime() + 5000).toISOString(), locked_until: null, error_code: code, error_message: message })
      .eq("id", job.id);
    await db().from("companies").update({ research_status: "queued", last_error: message }).eq("id", job.company_id);
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

  await db()
    .from("research_jobs")
    .update({ status: "failed", completed_at: new Date().toISOString(), locked_until: null, error_code: code, error_message: message })
    .eq("id", job.id);
  await db()
    .from("companies")
    .update({ research_status: "failed", last_error: message, next_refresh_at: new Date(nowMs + refreshDays * 86_400_000).toISOString() })
    .eq("id", job.company_id);
}

export interface ProcessResult {
  claimed: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  stoppedReason: string;
}

export async function processQueue({ budgetMs = 270_000, concurrency = 3 }: { budgetMs?: number; concurrency?: number } = {}): Promise<ProcessResult> {
  const start = Date.now();
  const deadline = start + budgetMs;
  const settings = await getSettings();
  const result: ProcessResult = { claimed: 0, succeeded: 0, failed: 0, durationMs: 0, stoppedReason: "queue empty" };
  let rateLimited = false;
  const running = new Set<Promise<void>>();

  const runOne = async (job: ResearchJob) => {
    try {
      const { reportId } = await withTimeout(runResearch(job), JOB_TIMEOUT_MS);
      await db()
        .from("research_jobs")
        .update({ status: "succeeded", completed_at: new Date().toISOString(), locked_until: null, report_id: reportId, error_code: null, error_message: null })
        .eq("id", job.id);
      result.succeeded++;
    } catch (err) {
      if (err instanceof RateLimitError) rateLimited = true;
      result.failed++;
      await handleFailure(job, err, settings.refresh_interval_days).catch((e) => console.error("[queue] could not record failure", e));
    }
  };

  for (;;) {
    if (rateLimited) {
      result.stoppedReason = "rate limited";
      break;
    }
    // Only start a job if it can plausibly finish inside this invocation.
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
    } else {
      await Promise.race(running);
    }
  }
  await Promise.allSettled([...running]);
  result.durationMs = Date.now() - start;
  return result;
}
