import { timingSafeEqual } from "node:crypto";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { env } from "@/lib/env";
import { db, check } from "@/lib/supabase/server";
import { updateSettings } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Scheduler entry point (Authorization: Bearer CRON_SECRET — Vercel Cron sends it automatically).
 *   Vercel Cron weekly (Mon 06:00 UTC)  ?source=vercel-weekly
 *   Vercel Cron daily  (07:00 UTC)      ?source=vercel-daily   — drains anything >7 days old
 *   Supabase pg_cron every 10 min       ?source=pg_cron        — picks up new rows & retries
 *   ?mode=drain                         — continue processing only (chained invocations)
 * Queues every active company that was never researched or whose weekly refresh is due, then
 * processes the queue in the background with the same pipeline as a manual refresh.
 */
export const GET = handler(async (req: Request) => {
  if (!env().CRON_SECRET) return fail("CRON_SECRET is not configured", 503);
  if (!authorized(req)) return fail("Unauthorized", 401);

  const params = new URL(req.url).searchParams;
  const mode = params.get("mode");
  const source = (params.get("source") ?? "cron").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "cron";
  let enqueued: { batch_id: string | null; queued: number } = { batch_id: null, queued: 0 };
  if (mode !== "drain") {
    enqueued = check(await db().rpc("enqueue_due_refreshes", { p_window_hours: 12 }), "Queueing due refreshes");
    await updateSettings({ last_scheduler_run_at: new Date().toISOString(), last_scheduler_result: { queued: enqueued.queued, batch_id: enqueued.batch_id, source } });
  }
  const { count } = await db().from("research_jobs").select("id", { count: "exact", head: true }).eq("status", "queued").lte("run_after", new Date().toISOString());
  if ((count ?? 0) > 0) scheduleProcessing(originOf(req), "cron", source);
  return ok({ mode: mode ?? "refresh", source, queuedNow: enqueued.queued, runnableJobs: count ?? 0 });
});
