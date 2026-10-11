import { z } from "zod";
import { fail, handler, ok } from "@/lib/api";
import { normalizeDomain, normalizeUrl, parseGithubOrg } from "@/lib/companyInput";
import { deleteCompany, getCompany, updateCompany } from "@/lib/data";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const uuid = z.uuid();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    website: z.string().max(300).nullable().optional(),
    github: z.string().max(300).nullable().optional(),
    careers_url: z.string().max(500).nullable().optional(),
    blog_url: z.string().max(500).nullable().optional(),
    watchlist_status: z.enum(["active", "paused"]).optional(),
  })
  .strict();

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const id = uuid.parse((await params).id);
  const company = await getCompany(id);
  return company ? ok({ company }) : fail("Company not found", 404);
});

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const id = uuid.parse((await params).id);
  const p = patchSchema.parse(await req.json());
  const patch: Parameters<typeof updateCompany>[1] = {};
  try {
    if (p.name !== undefined) patch.name = p.name.replace(/\s+/g, " ");
    if (p.website !== undefined) patch.domain = normalizeDomain(p.website);
    if (p.github !== undefined) patch.github_org = parseGithubOrg(p.github);
    if (p.careers_url !== undefined) patch.careers_url = normalizeUrl(p.careers_url, "careers URL");
    if (p.blog_url !== undefined) patch.blog_url = normalizeUrl(p.blog_url, "blog URL");
    if (p.watchlist_status !== undefined) patch.watchlist_status = p.watchlist_status;
  } catch (e) {
    return fail((e as Error).message, 422);
  }
  try {
    return ok({ company: await updateCompany(id, patch) });
  } catch (e) {
    return fail((e as Error).message, 409);
  }
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const id = uuid.parse((await params).id);
  await deleteCompany(id);
  return ok({ deleted: id });
});
