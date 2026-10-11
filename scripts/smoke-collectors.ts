/**
 * Live smoke test of every collector against one real company (no database writes).
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/smoke-collectors.ts \
 *       Stripe stripe.com stripe greenhouse stripe [--web]
 *
 * --web also runs the Gemini + Google Search web-research step (uses one Gemini request).
 */
import { GitHubClient, collectGithub, identifyGithubOrg } from "../src/lib/collectors/github";
import { collectJobs } from "../src/lib/collectors/jobs";
import { collectDns } from "../src/lib/collectors/dns";
import { collectCrtsh } from "../src/lib/collectors/crtsh";
import { collectHn } from "../src/lib/collectors/hn";
import { collectRss } from "../src/lib/collectors/rss";
import { buildStack } from "../src/lib/research/analysis";
import { activityScore, fitScore } from "../src/lib/scoring";
import type { EvidenceItem } from "../src/lib/types";

const [name = "Stripe", domain = "stripe.com", org = "", provider = "", slug = ""] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const withWeb = process.argv.includes("--web");
const company = {
  name,
  domain,
  github_org: org || null,
  job_board_provider: (provider || null) as "greenhouse" | "lever" | "ashby" | null,
  job_board_slug: slug || null,
  blog_rss_url: null,
};

async function step<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`\n■ ${label} — ${((Date.now() - t) / 1000).toFixed(1)}s`);
    return r;
  } catch (e) {
    console.log(`\n■ ${label} — FAILED after ${((Date.now() - t) / 1000).toFixed(1)}s: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  const evidence: EvidenceItem[] = [];
  const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN });

  const g = await step("GitHub", async () => {
    const { ident, profile } = await identifyGithubOrg(gh, company);
    console.log(`  identification: ${ident.method} ${ident.login ?? ""} — ${ident.note}`);
    if (!profile) return null;
    const col = await collectGithub(gh, profile, { maxRepos: 6 });
    const a = col.activity;
    console.log(`  repos listed ${a.repos_listed} (scanned ${a.repos_analyzed}); active 30d ${a.repos_active_30d} / 90d ${a.repos_active_90d}`);
    console.log(`  commits 90d ${a.commits_90d} (52w series ${a.commits_52w.length ? "yes" : "no"}, ${a.commit_repos_sampled} repos); contributors ${a.contributors}; releases 90d ${a.releases_90d}`);
    console.log(`  languages:        ${col.languages.slice(0, 6).map((l) => `${l.name} ${l.pct}%`).join(", ")}`);
    console.log(`  recent languages: ${col.recentLanguages.slice(0, 6).map((l) => `${l.name} ${l.pct}%`).join(", ")}`);
    console.log(`  ${gh.requests} GitHub requests, rate remaining ${gh.rateRemaining}`);
    evidence.push(...col.evidence);
    return col;
  });
  const j = await step("Job board", async () => {
    const r = await collectJobs(company, g ? org || null : null);
    console.log(`  ${r.status.status}: ${r.status.message}`);
    console.log(`  top mentions: ${r.hiring.tech_mentions.slice(0, 10).map((t) => `${t.tech}(${t.count})`).join(", ")}`);
    r.hiring.sample_roles.forEach((s) => console.log(`  • ${s.title} — ${s.techs.join(", ")}`));
    evidence.push(...r.evidence);
    return r;
  });
  await step("DNS", async () => {
    const r = await collectDns(domain);
    console.log(`  ${r.status.message}`);
    console.log(`  hosting: ${r.dns.hosting.map((h) => `${h.provider} (${h.record})`).join("; ") || "-"}`);
    console.log(`  SaaS: ${r.dns.saas_verifications.map((v) => v.service).join(", ") || "-"}; SPF: ${r.dns.spf_includes.map((s) => s.service ?? s.domain).join(", ") || "-"}`);
    evidence.push(...r.evidence);
  });
  await step("crt.sh", async () => {
    const r = await collectCrtsh(domain);
    console.log(`  ${r.status.message}`);
    console.log(`  tooling: ${r.subdomains.tooling.map((t) => `${t.subdomain} (${t.tool})`).slice(0, 10).join(", ") || "-"}`);
    evidence.push(...r.evidence);
  });
  await step("Hacker News", async () => {
    const r = await collectHn(company);
    console.log(`  ${r.status.message}`);
    r.stories.forEach((s) => console.log(`  • [${s.points}] ${s.title}`));
    evidence.push(...r.evidence);
  });
  await step("Blog RSS", async () => {
    const r = await collectRss(company);
    console.log(`  ${r.status.status}: ${r.status.message}`);
    r.posts.forEach((p) => console.log(`  • ${p.technical ? "[tech] " : ""}${p.title}`));
    evidence.push(...r.evidence);
  });
  if (withWeb) {
    await step("Web research (Gemini + Google Search)", async () => {
      const { collectWebResearch } = await import("../src/lib/collectors/webResearch");
      const r = await collectWebResearch(company);
      console.log(`  ${r.status.message}`);
      r.research.findings.forEach((f) => console.log(`  • ${f.title} — ${f.url}`));
      evidence.push(...r.evidence);
    });
  }

  const hiring = j?.hiring ?? { eng_open_roles: 0, tech_mentions: [] };
  const stack = buildStack(evidence, g?.languages ?? [], new Map(), new Date().toISOString(), hiring);
  console.log(`\n■ Stack: ${stack.length} technologies`);
  for (const s of stack.slice(0, 40)) console.log(`  ${s.id.padEnd(4)} ${s.category.padEnd(13)} ${s.tech.padEnd(22)} ${s.confidence.padEnd(6)} ${s.kinds.join("+")}`);
  if (g) {
    const act = activityScore(g.activity, hiring);
    const fit = fitScore(
      { target_languages: ["Go", "TypeScript", "Java", "Kotlin", "Python"], target_clouds: ["AWS", "Google Cloud", "Microsoft Azure"], target_signals: ["Microservices", "Kubernetes", "Docker", "Monorepo", "GitHub Actions", "gRPC", "Terraform"] },
      stack,
      g.recentLanguages,
      g.languages,
      hiring,
    );
    console.log(`\n■ Activity score ${act.score}: ${act.components.map((c) => `${c.name} ${c.points}/${c.max}`).join(", ")}`);
    console.log(`■ Fit score ${fit.score}: ${fit.components.map((c) => `${c.name} ${c.points}/${c.max} (${c.detail})`).join("; ")}`);
  }
}

main();
