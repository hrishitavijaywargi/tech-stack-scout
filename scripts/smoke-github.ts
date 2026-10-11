/**
 * Live smoke test of the evidence collectors against real public APIs (no database, no AI).
 *   npx tsx scripts/smoke-github.ts "<Company name>" [domain] [github-org] [maxRepos]
 * Uses GITHUB_TOKEN from the environment when set.
 */
import { GitHubClient, collectGithub, identifyGithubOrg } from "../src/lib/sources/github";
import { collectJobPostings } from "../src/lib/sources/jobs";
import { collectBlog, collectHackerNews } from "../src/lib/sources/articles";
import { buildStack, scoreConfidence } from "../src/lib/research/analysis";

if (process.env.TRACE) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const t = Date.now();
    try {
      const res = await real(input, init);
      console.log(`  ${res.status} ${Date.now() - t}ms ${String(input).slice(0, 110)}`);
      return res;
    } catch (e) {
      console.log(`  ERR ${Date.now() - t}ms ${String(input).slice(0, 110)} ${(e as Error).message}`);
      throw e;
    }
  }) as typeof fetch;
}

async function main() {
  const [name = "Vercel", domain = "vercel.com", org = "", max = "4"] = process.argv.slice(2);
  const company = { name, domain: domain || null, github_org: org || null, careers_url: null, blog_url: null };
  const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN });
  const t0 = Date.now();

  const { ident, profile } = await identifyGithubOrg(gh, company);
  console.log(`GitHub identification: ${ident.method} ${ident.login ?? ""} — ${ident.note}`);
  const evidence = [];
  let reposAnalyzed = 0;
  let languages: Awaited<ReturnType<typeof collectGithub>>["languages"] = [];
  if (profile) {
    const col = await collectGithub(gh, profile, { maxRepos: Number(max) });
    evidence.push(...col.evidence);
    languages = col.languages;
    reposAnalyzed = col.activity.reposAnalyzed;
    console.log(`Activity: ${col.activity.level} — ${col.activity.levelReason}`);
    console.log(`Releases (180d): ${col.activity.releases180d.map((r) => `${r.repo}@${r.tag}`).slice(0, 5).join(", ") || "none"}`);
  }
  const jobs = await collectJobPostings(company, ident.login);
  const blog = await collectBlog(company);
  const hn = await collectHackerNews(company);
  evidence.push(...jobs.evidence, ...blog.evidence, ...hn.evidence);
  for (const s of [jobs.status, blog.status, hn.status]) console.log(`${s.source}: ${s.status} — ${s.detail}`);

  const stack = buildStack(evidence, languages, new Map(), new Date().toISOString());
  console.log(`\n${stack.length} technologies:`);
  for (const s of stack) console.log(`  ${s.id.padEnd(4)} [${s.category}] ${s.technology}${s.share !== undefined ? ` ${(s.share * 100).toFixed(1)}%` : ""} — ${s.evidence[0].text.slice(0, 110)}`);
  const conf = scoreConfidence({ githubMethod: ident.method, reposAnalyzed, evidence });
  console.log(`\nConfidence: ${conf.level} (${conf.score})  ·  GitHub requests: ${gh.requests}, remaining ${gh.rateRemaining}  ·  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
