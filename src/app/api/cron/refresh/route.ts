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
 * Scheduler entry point. Called by Supabase pg_cron (every 10 min) and Vercel Cron (weekly).
 *  - queues every active company whose weekly refresh is due (skipped with ?mode=drain)
 *  - drains the research queue in the background, reusing the same pipeline as manual refresh
 */
export const GET = handler(async (req: Request) => {
  if (!env().CRON_SECRET) return fail("CRON_SECRET is not configured", 503);
  if (!authorized(req)) return fail("Unauthorized", 401);

  const mode = new URL(req.url).searchParams.get("mode");
  let enqueued: { batch_id: string | null; queued: number } = { batch_id: null, queued: 0 };
  if (mode !== "drain") {
    enqueued = check(await db().rpc("enqueue_due_refreshes", { p_window_hours: 12 }), "Queueing due refreshes");
    await updateSettings({
      last_scheduler_run_at: new Date().toISOString(),
      last_scheduler_result: { queued: enqueued.queued, batch_id: enqueued.batch_id },
    });
  }
  const { count } = await db().from("research_jobs").select("id", { count: "exact", head: true }).eq("status", "queued");
  if ((count ?? 0) > 0) scheduleProcessing(originOf(req));
  return ok({ mode: mode ?? "refresh", queuedNow: enqueued.queued, pendingJobs: count ?? 0 });
});
