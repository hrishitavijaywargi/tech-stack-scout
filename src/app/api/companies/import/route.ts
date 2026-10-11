import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { MAX_CSV_ROWS, findDuplicate, normalizeCompany, type CompanyInput } from "@/lib/companyInput";
import { addCompanies, enqueue } from "@/lib/data";

export const dynamic = "force-dynamic";

const body = z.object({
  rows: z.array(z.unknown()).min(1, "No rows to import").max(MAX_CSV_ROWS),
  research: z.boolean().default(true),
});

/** Bulk add (rows are parsed in the browser for preview; every row is re-validated here). */
export const POST = handler(async (req: Request) => {
  const { rows, research } = body.parse(await req.json());
  const valid: CompanyInput[] = [];
  const invalid: { row: number; errors: string[] }[] = [];
  const duplicates: { name: string; reason: string }[] = [];
  rows.forEach((r, i) => {
    const n = normalizeCompany(r);
    if (!n.ok) return invalid.push({ row: i + 1, errors: n.errors });
    const dup = findDuplicate(n.value, valid);
    if (dup) return duplicates.push({ name: n.value.name, reason: `Duplicate of "${dup.name}" in this file` });
    valid.push(n.value);
  });
  if (!valid.length) return fail("No valid companies to import", 422, { invalid, duplicates });

  const added = await addCompanies(valid);
  duplicates.push(...added.duplicates);
  let batch: { batch_id: string | null; queued: number } | null = null;
  if (research && added.created.length) {
    batch = await enqueue(
      added.created.map((c) => c.id),
      "bulk",
      `CSV import · ${added.created.length} companies`,
    );
    scheduleProcessing(originOf(req));
  }
  return ok({ created: added.created.length, duplicates, invalid, batch }, 201);
});
