import "server-only";
import { after, NextResponse } from "next/server";
import { ZodError } from "zod";
import { ConfigError, env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http";
import { processQueue } from "@/lib/jobs/queue";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Wrap a route handler: consistent JSON errors, no stack traces or secrets in responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof ConfigError) return fail(err.message, 503, { code: "not_configured" });
      if (err instanceof ZodError) return fail(err.issues.map((i) => i.message).join("; "), 400);
      if (err instanceof SyntaxError) return fail("Request body must be valid JSON", 400);
      console.error("[api]", (err as Error).message);
      return fail((err as Error).message || "Unexpected error", 500);
    }
  };
}

/**
 * Process the research queue after the response is sent (Vercel waitUntil). If the time
 * budget runs out with work left, chain another invocation through the cron endpoint.
 */
export function scheduleProcessing(origin: string, trigger: "cron" | "manual" = "manual", source = "ui") {
  after(async () => {
    try {
      const r = await processQueue({ trigger, source });
      console.log(`[queue] ${JSON.stringify(r)}`);
      if (r.stoppedReason === "time budget reached") await chainWorker(origin, trigger);
    } catch (err) {
      console.error("[queue] processing failed:", (err as Error).message);
    }
  });
}

async function chainWorker(origin: string, trigger: "cron" | "manual") {
  const secret = env().CRON_SECRET;
  if (!secret) return; // The scheduled job will pick the rest up.
  await fetchWithTimeout(`${origin}/api/cron/refresh?mode=drain&source=chain-${trigger}`, { headers: { Authorization: `Bearer ${secret}` }, timeoutMs: 5000 }).catch(() => undefined);
}

export function originOf(req: Request) {
  return new URL(req.url).origin;
}
