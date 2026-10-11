import { handler } from "@/lib/api";
import { toCsv } from "@/lib/companyInput";
import { latestReportsByCompany, listCompanies } from "@/lib/data";
import { CATEGORY_ORDER, type StackItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const [companies, reports] = await Promise.all([listCompanies(), latestReportsByCompany()]);
  const rows = companies.map((c) => {
    const r = reports.get(c.id);
    const stack = (r?.tech_stack ?? []) as StackItem[];
    const cat = (k: (typeof CATEGORY_ORDER)[number]) =>
      stack
        .filter((s) => s.category === k)
        .map((s) => (s.share !== undefined ? `${s.technology} (${(s.share * 100).toFixed(0)}%)` : s.technology))
        .join("; ") || (r ? "Not publicly found" : "");
    return {
      company: c.name,
      website: c.domain ?? "",
      github_org: c.github_org ?? c.detected_github_org ?? "",
      github_match: c.github_org ? "provided" : (c.detected_github_org_method ?? ""),
      research_status: c.research_status,
      last_researched_at: c.last_researched_at ?? "",
      next_refresh_at: c.next_refresh_at ?? "",
      report_version: r?.version ?? "",
      confidence: r?.confidence_level ?? "",
      languages: cat("language"),
      frameworks: cat("framework"),
      cloud: cat("cloud"),
      infrastructure: cat("infrastructure"),
      architecture: cat("architecture"),
      activity_level: r?.engineering_activity?.level ?? "",
      outreach_opening: r ? (r.outreach.status === "ready" ? r.outreach.line : `Insufficient evidence: ${r.outreach.insufficientReason}`) : "",
      summary: r ? r.summary_paragraphs.join("\n\n") : "",
      last_error: c.last_error ?? "",
    };
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${toCsv(rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tech-stack-scout-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
