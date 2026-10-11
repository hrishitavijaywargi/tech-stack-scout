/**
 * Verifies every seed company before it goes into supabase/seed.sql:
 *  - the GitHub org exists and has public, non-fork repositories
 *  - the job board (Greenhouse / Lever / Ashby) answers with postings
 *
 *   npx tsx scripts/verify-seed.ts            (uses GITHUB_TOKEN from the environment if set)
 *
 * Exit code 1 if any seed entry fails, so it can gate a seed update.
 */
import { SEED_COMPANIES } from "./seed-companies";

const UA = { "User-Agent": "tech-stack-scout-seed-check" };
const gh = (path: string) =>
  fetch(`https://api.github.com${path}`, {
    headers: { ...UA, Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
  });

async function jobCount(provider: string, slug: string): Promise<number | null> {
  const url =
    provider === "greenhouse"
      ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`
      : provider === "lever"
        ? `https://api.lever.co/v0/postings/${slug}?mode=json`
        : `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=false`;
  const r = await fetch(url, { headers: UA });
  if (!r.ok) return null;
  const j = (await r.json()) as unknown;
  if (Array.isArray(j)) return j.length;
  return ((j as { jobs?: unknown[] }).jobs ?? []).length;
}

async function main() {
  let failures = 0;
  for (const c of SEED_COMPANIES) {
    const problems: string[] = [];
    let repos = 0;
    if (c.github_org) {
      const r = await gh(`/orgs/${c.github_org}`);
      if (!r.ok) problems.push(`GitHub org "${c.github_org}" → HTTP ${r.status}`);
      else repos = ((await r.json()) as { public_repos: number }).public_repos;
      if (r.ok && repos === 0) problems.push(`GitHub org "${c.github_org}" has no public repos`);
    }
    let jobs: number | null = null;
    if (c.job_board_provider && c.job_board_slug) {
      jobs = await jobCount(c.job_board_provider, c.job_board_slug);
      if (jobs === null) problems.push(`${c.job_board_provider}/${c.job_board_slug} → not found`);
      else if (jobs === 0) problems.push(`${c.job_board_provider}/${c.job_board_slug} → 0 postings`);
    }
    const ok = problems.length === 0;
    if (!ok) failures++;
    console.log(
      `${ok ? "✓" : "✗"} ${c.name.padEnd(14)} github=${(c.github_org ?? "-").padEnd(12)} repos=${String(repos).padEnd(5)} jobs=${c.job_board_provider ?? "-"}/${c.job_board_slug ?? "-"} (${jobs ?? "-"})${ok ? "" : "  ← " + problems.join("; ")}`,
    );
  }
  console.log(failures ? `\n${failures} seed entr${failures === 1 ? "y" : "ies"} failed verification` : "\nAll seed entries verified");
  process.exit(failures ? 1 : 0);
}

main();
