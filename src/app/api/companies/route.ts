import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { normalizeCompany } from "@/lib/companyInput";
import { addCompanies, enqueue, listCompanies } from "@/lib/data";

export const dynamic = "force-dynamic";

export const GET = handler(async () => ok({ companies: await listCompanies() }));

const body = z.object({ company: z.unknown(), research: z.boolean().default(true) });

export const POST = handler(async (req: Request) => {
  const { company, research } = body.parse(await req.json());
  const n = normalizeCompany(company);
  if (!n.ok) return fail(n.errors.join("; "), 422);
  const { created, duplicates } = await addCompanies([n.value]);
  if (!created.length) return fail(duplicates[0]?.reason ?? "Already on the watchlist", 409);
  if (research) {
    await enqueue([created[0].id], "initial", null);
    scheduleProcessing(originOf(req));
  }
  return ok({ company: created[0] }, 201);
});
