import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { enqueue, listCompanies } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.union([z.object({ companyIds: z.array(z.uuid()).min(1).max(500) }), z.object({ scope: z.enum(["all", "needs_attention", "stale"]) })]);

const STALE_MS = 7 * 86_400_000;

/** Queue research: specific companies, Research All, needs attention, or "Refresh all stale now". */
export const POST = handler(async (req: Request) => {
  const b = body.parse(await req.json());
  let ids: string[];
  let label: string | null;
  if ("companyIds" in b) {
    ids = b.companyIds;
    label = ids.length > 1 ? `Manual refresh · ${ids.length} companies` : null;
  } else {
    const companies = await listCompanies();
    const pick =
      b.scope === "all"
        ? companies
        : b.scope === "stale"
          ? companies.filter((c) => !c.last_researched_at || Date.now() - Date.parse(c.last_researched_at) > STALE_MS)
          : companies.filter((c) => c.research_status === "failed" || c.research_status === "not_started");
    ids = pick.map((c) => c.id);
    label = { all: "Research all", stale: "Refresh stale", needs_attention: "Needs attention" }[b.scope] + ` · ${ids.length} companies`;
  }
  if (!ids.length) return fail(b && "scope" in b && b.scope === "stale" ? "Nothing is stale — every company was researched in the last 7 days." : "No active companies to research", 422);
  const res = await enqueue(ids, ids.length > 1 ? "bulk" : "manual", label);
  if (res.queued > 0) scheduleProcessing(originOf(req), "manual", "ui");
  return ok({ ...res, alreadyQueued: res.requested - res.queued });
});
