import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { enqueue, getCompany } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Refresh now" for one company. Idempotent: an already queued/running job is reused. */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = z.uuid().parse((await params).id);
  const company = await getCompany(id);
  if (!company) return fail("Company not found", 404);
  if (!company.is_active) return fail("This company is not on the active watchlist", 409);
  const res = await enqueue([id], "manual", null);
  scheduleProcessing(originOf(req), "manual", "ui");
  return ok({ ...res, alreadyQueued: res.requested - res.queued });
});
