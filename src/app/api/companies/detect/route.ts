import { z } from "zod";
import { fail, handler, ok } from "@/lib/api";
import { env } from "@/lib/env";
import { normalizeDomain } from "@/lib/companyInput";
import { GitHubClient, identifyGithubOrg } from "@/lib/collectors/github";
import { discoverBoard } from "@/lib/collectors/jobs";
import { collectRss } from "@/lib/collectors/rss";
import { supabaseHttpCache } from "@/lib/data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const body = z.object({ name: z.string().trim().min(1).max(200), website: z.string().trim().min(1).max(300) });

/** "Auto-detect" in the Add company dialog: GitHub org, job board and blog feed suggestions. */
export const POST = handler(async (req: Request) => {
  const { name, website } = body.parse(await req.json());
  let domain: string | null;
  try {
    domain = normalizeDomain(website);
  } catch (e) {
    return fail((e as Error).message, 422);
  }
  if (!domain) return fail("Website / domain is required", 422);

  const gh = new GitHubClient({ token: env().GITHUB_TOKEN, cache: supabaseHttpCache });
  const [github, board, rss] = await Promise.allSettled([
    identifyGithubOrg(gh, { name, domain, github_org: null }),
    discoverBoard({ name, domain }, null),
    collectRss({ domain, blog_rss_url: null }),
  ]);
  const ident = github.status === "fulfilled" ? github.value.ident : null;
  return ok({
    domain,
    github: ident?.login ? { login: ident.login, method: ident.method, note: ident.note } : { login: null, method: "none", note: ident?.note ?? "GitHub lookup failed" },
    job_board: board.status === "fulfilled" && board.value ? { provider: board.value.provider, slug: board.value.slug, postings: board.value.postings.length } : null,
    blog_rss_url: rss.status === "fulfilled" ? rss.value.feedUrl : null,
  });
});
