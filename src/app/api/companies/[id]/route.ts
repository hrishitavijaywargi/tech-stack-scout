import { z } from "zod";
import { fail, handler, ok } from "@/lib/api";
import { normalizeDomain, normalizeUrl, parseGithubOrg, parseJobBoard } from "@/lib/companyInput";
import { deleteCompany, getCompany, updateCompany, type CompanyPatch } from "@/lib/data";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
const uuid = z.uuid();

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    website: z.string().max(300).optional(),
    github: z.string().max(300).nullable().optional(),
    careers_url: z.string().max(500).nullable().optional(),
    job_board_provider: z.string().max(20).nullable().optional(),
    job_board_slug: z.string().max(100).nullable().optional(),
    blog_rss_url: z.string().max(500).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  const company = await getCompany(uuid.parse((await params).id));
  return company ? ok({ company }) : fail("Company not found", 404);
});

/** Edit sources / deactivate ("remove from watchlist") / reactivate. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const id = uuid.parse((await params).id);
  const p = patchSchema.parse(await req.json());
  const patch: CompanyPatch = {};
  try {
    if (p.name !== undefined) patch.name = p.name.replace(/\s+/g, " ");
    if (p.website !== undefined) {
      const d = normalizeDomain(p.website);
      if (!d) throw new Error("Website / domain is required");
      patch.domain = d;
    }
    if (p.github !== undefined) patch.github_org = parseGithubOrg(p.github);
    if (p.careers_url !== undefined || p.job_board_provider !== undefined || p.job_board_slug !== undefined) {
      const board = parseJobBoard(p.job_board_provider, p.job_board_slug, p.careers_url);
      patch.job_board_provider = board?.provider ?? null;
      patch.job_board_slug = board?.slug ?? null;
    }
    if (p.blog_rss_url !== undefined) patch.blog_rss_url = normalizeUrl(p.blog_rss_url, "blog RSS URL");
    if (p.notes !== undefined) patch.notes = p.notes?.trim() || null;
    if (p.is_active !== undefined) patch.is_active = p.is_active;
  } catch (e) {
    return fail((e as Error).message, 422);
  }
  try {
    return ok({ company: await updateCompany(id, patch) });
  } catch (e) {
    return fail((e as Error).message, 409);
  }
});

/** Permanently delete the company and its snapshots (the UI's "Remove" deactivates instead). */
export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const id = uuid.parse((await params).id);
  await deleteCompany(id);
  return ok({ deleted: id });
});
