import { handler } from "@/lib/api";
import { toCsv } from "@/lib/companyInput";
import { latestStates } from "@/lib/data";
import { CATEGORY_ORDER, type StackItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/** CSV export of the whole watchlist with the latest snapshot + insight for each company. */
export const GET = handler(async () => {
  const rows = (await latestStates()).map((c) => {
    const stack = (c.infra_signals ?? []) as StackItem[];
    const cat = (k: (typeof CATEGORY_ORDER)[number]) =>
      stack
        .filter((s) => s.category === k)
        .map((s) => `${s.tech}${s.pct !== undefined ? ` ${s.pct}%` : ""} (${s.confidence})`)
        .join("; ") || (c.snapshot_id ? "Not publicly found" : "");
    return {
      company: c.name,
      domain: c.domain,
      github_org: c.github_org ?? c.detected_github_org ?? "",
      job_board: c.job_board_provider ? `${c.job_board_provider}/${c.job_board_slug}` : "",
      research_status: c.research_status,
      last_refreshed: c.captured_at ?? "",
      next_refresh: c.next_refresh_at ?? "",
      activity_score: c.activity_score ?? "",
      fit_score: c.fit_score ?? "",
      confidence: c.confidence?.level ?? "",
      recent_languages: (c.recent_languages ?? []).slice(0, 5).map((l) => `${l.name} ${l.pct}%`).join("; "),
      eng_open_roles: c.hiring?.eng_open_roles ?? "",
      ...Object.fromEntries(CATEGORY_ORDER.filter((k) => k !== "language").map((k) => [k, cat(k)])),
      outreach_line: c.outreach_line ?? (c.snapshot_id ? "(insufficient evidence)" : ""),
      outreach_rationale: c.outreach_rationale ?? "",
      summary: c.summary ?? "",
      last_error: c.last_error ?? "",
    };
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${toCsv(rows)}`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tech-stack-scout-${date}.csv"`, "Cache-Control": "no-store" },
  });
});
