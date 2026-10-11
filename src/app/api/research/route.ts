import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { enqueue, listCompanies } from "@/lib/data";

export const dynamic = "force-dynamic";

const body = z.union([
  z.object({ companyIds: z.array(z.uuid()).min(1).max(500) }),
  z.object({ scope: z.enum(["all", "needs_attention"]) }),
]);

/** Queue research (manual refresh, Research All, retry failed). Idempotent per company. */
export const POST = handler(async (req: Request) => {
  const b = body.parse(await req.json());
  let ids: string[];
  let label: string | null;
  if ("companyIds" in b) {
    ids = b.companyIds;
    label = ids.length > 1 ? `Manual refresh · ${ids.length} companies` : null;
  } else {
    const companies = (await listCompanies()).filter((c) => c.watchlist_status === "active");
    const pick = b.scope === "all" ? companies : companies.filter((c) => c.research_status === "failed" || c.research_status === "not_started");
    ids = pick.map((c) => c.id);
    label = b.scope === "all" ? `Research all · ${ids.length} companies` : `Needs attention · ${ids.length} companies`;
  }
  if (!ids.length) return fail("No active companies to research", 422);
  const res = await enqueue(ids, ids.length > 1 ? "bulk" : "manual", label);
  if (res.queued > 0) scheduleProcessing(originOf(req));
  return ok({ ...res, alreadyQueued: res.requested - res.queued });
});
