import "server-only";
import { configStatus, env } from "@/lib/env";
import { checkGemini } from "@/lib/ai/gemini";
import { fetchWithTimeout } from "@/lib/http";
import { db } from "@/lib/supabase/server";

export interface ConnectionStatus {
  name: string;
  ok: boolean;
  detail: string;
}

export async function getConnectionStatus(): Promise<{ checks: ConnectionStatus[] }> {
  const cfg = configStatus();
  const checks: ConnectionStatus[] = [];

  if (!cfg.supabase) checks.push({ name: "Supabase", ok: false, detail: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" });
  else {
    const res = await db().from("app_settings").select("id").limit(1);
    checks.push({ name: "Supabase", ok: !res.error, detail: res.error ? `Error: ${res.error.message}` : "Connected · migrations applied" });
  }

  checks.push({ name: "Gemini Flash", ...(await checkGemini()) });

  try {
    const token = env().GITHUB_TOKEN;
    const res = await fetchWithTimeout("https://api.github.com/rate_limit", {
      headers: { "User-Agent": "tech-stack-scout", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeoutMs: 8000,
    });
    if (res.status === 401) checks.push({ name: "GitHub API", ok: false, detail: "Token rejected (401)" });
    else {
      const j = (await res.json()) as { resources: { core: { remaining: number; limit: number; reset: number } } };
      const c = j.resources.core;
      checks.push({
        name: "GitHub API",
        ok: c.remaining > 0,
        detail: `${token ? "Authenticated" : "Unauthenticated — add GITHUB_TOKEN"} · ${c.remaining}/${c.limit} requests left, resets ${new Date(c.reset * 1000).toISOString().slice(11, 16)} UTC`,
      });
    }
  } catch (err) {
    checks.push({ name: "GitHub API", ok: false, detail: (err as Error).message });
  }

  checks.push({
    name: "Scheduler secret",
    ok: cfg.cronSecret,
    detail: cfg.cronSecret ? "CRON_SECRET set" : "CRON_SECRET not set — the scheduled refresh endpoint is disabled",
  });
  return { checks };
}
