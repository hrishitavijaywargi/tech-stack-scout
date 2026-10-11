import "server-only";
import { env } from "@/lib/env";
import { db, check } from "@/lib/supabase/server";
import { HttpError, RateLimitError } from "@/lib/http";
import { getCompany, getProductProfile, getSettings, latestSnapshot, supabaseHttpCache } from "@/lib/data";
import { timed } from "@/lib/collectors/common";
import { GitHubClient, collectGithub, emptyActivity, identifyGithubOrg, type GithubCollection } from "@/lib/collectors/github";
import { collectJobs, emptyHiring } from "@/lib/collectors/jobs";
import { collectDns } from "@/lib/collectors/dns";
import { collectCrtsh } from "@/lib/collectors/crtsh";
import { collectHn } from "@/lib/collectors/hn";
import { collectRss } from "@/lib/collectors/rss";
import { collectWebResearch, emptyResearch } from "@/lib/collectors/webResearch";
import { buildStack, diffSnapshots, scoreConfidence, techKey, type DiffInput } from "@/lib/research/analysis";
import { activityScore, fitScore } from "@/lib/scoring";
import { geminiJson } from "@/lib/ai/gemini";
import { SYSTEM_PROMPT, buildFacts, buildPrompt, geminiResponseSchema, insufficientEvidenceInsight, toInsight, validateAiReport, type InsightOutput, type ReportInput } from "@/lib/ai/report";
import { CATEGORY_LABELS, CATEGORY_ORDER, SOURCE_LABELS, type DnsInfo, type EvidenceItem, type GithubIdentification, type ResearchJob, type SourceKey, type SourceRef, type SourceStatusEntry } from "@/lib/types";

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

const log = (jobId: string, msg: string) => console.log(`[research ${jobId.slice(0, 8)}] ${msg}`);
const skipped = (message: string): SourceStatusEntry => ({ status: "skipped", message, duration_ms: 0 });

/** GitHub is the main source: rate limits and transient failures fail the job (it is retried). */
const githubMustRetry = (err: unknown) => err instanceof RateLimitError || (err instanceof HttpError && (err.status === 0 || err.status >= 500));

/**
 * The single research pipeline used by manual, bulk and scheduled refreshes:
 * collect (7 sources in parallel; a failing source never fails the company) → store sources +
 * findings → aggregate stack with per-technology confidence → scores → Gemini insight
 * (validated) → company_snapshots + company_insights rows → diff vs previous snapshot.
 */
export async function runResearch(job: ResearchJob, deadline = Number.POSITIVE_INFINITY): Promise<{ snapshotId: string }> {
  // A run that overshoots its deadline stops before writing anything, so a timed-out job can
  // never save a late snapshot after the queue has already marked it failed.
  const checkDeadline = (stage: string) => {
    if (Date.now() > deadline) throw new Error(`Research timed out (during ${stage})`);
  };
  const company = await getCompany(job.company_id);
  if (!company) throw new PermanentError("The company was removed from the watchlist.");
  const [settings, profile, prev] = await Promise.all([getSettings(), getProductProfile(), latestSnapshot(company.id)]);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const status: Partial<Record<SourceKey, SourceStatusEntry>> = {};

  // ---------------------------------------------------------------- 1. Collect (parallel)
  const gh = new GitHubClient({ token: env().GITHUB_TOKEN, cache: supabaseHttpCache });
  const knownLogin = company.github_org ?? company.detected_github_org;

  const githubTask = timed<{ ident: GithubIdentification; col: GithubCollection | null }>(
    async () => {
      const found = await identifyGithubOrg(gh, company);
      if (!found.profile) return { value: { ident: found.ident, col: null }, status: { status: "not_found" as const, message: found.ident.note } };
      const col = await collectGithub(gh, found.profile, { maxRepos: settings.max_repos, now });
      return {
        value: { ident: found.ident, col },
        status: {
          status: "ok" as const,
          items: col.activity.repos_listed,
          url: found.profile.html_url,
          message: `${found.profile.login}: ${col.activity.repos_listed} public repositories (${gh.authenticated ? "GraphQL" : "REST"}), ${col.activity.repos_analyzed} scanned in depth; ${gh.requests} API calls, ${gh.cacheHits} cached.`,
        },
      };
    },
    { ident: { login: null, method: "none", profileUrl: null, displayName: null, blog: null, candidates: [], note: "GitHub lookup failed." } as GithubIdentification, col: null },
    githubMustRetry,
  );

  const [github, jobs, dns, crt, hn, rss, web] = await Promise.all([
    githubTask,
    settings.include_job_boards ? timed(async () => { const r = await collectJobs(company, knownLogin); return { value: r, status: r.status }; }, null) : null,
    timed(async () => { const r = await collectDns(company.domain); return { value: r, status: r.status }; }, null),
    timed(async () => { const r = await collectCrtsh(company.domain); return { value: r, status: r.status }; }, null),
    settings.include_hacker_news ? timed(async () => { const r = await collectHn(company, now); return { value: r, status: r.status }; }, null) : null,
    settings.include_blogs ? timed(async () => { const r = await collectRss(company); return { value: r, status: r.status }; }, null) : null,
    env().WEB_RESEARCH_ENABLED ? timed(async () => { const r = await collectWebResearch(company); return { value: r, status: r.status }; }, null) : null,
  ]);
  status.github = github.status;
  status.jobs = jobs?.status ?? skipped("Disabled in Settings.");
  status.dns = dns.status;
  status.crtsh = crt.status;
  status.hn = hn?.status ?? skipped("Disabled in Settings.");
  status.rss = rss?.status ?? skipped("Disabled in Settings.");
  status.web_research = web?.status ?? skipped("Disabled (WEB_RESEARCH_ENABLED=false).");

  const ident = github.value.ident;
  const gcol = github.value.col;
  const activity = gcol?.activity ?? emptyActivity("Not publicly found", ident.note);
  const hiring = { ...(jobs?.value?.hiring ?? emptyHiring()), previous_eng_open_roles: prev?.hiring?.provider ? prev.hiring.eng_open_roles : null };
  const dnsInfo: DnsInfo = dns.value?.dns ?? { hosting: [], email_provider: null, saas_verifications: [], spf_includes: [], nameservers: [] };
  const subdomains = crt.value?.subdomains ?? { count: 0, tooling: [] };
  const hnStories = hn?.value?.stories ?? [];
  const blogPosts = rss?.value?.posts ?? [];
  const webResearch = web?.value?.research ?? emptyResearch();

  const evidence: EvidenceItem[] = [
    ...(gcol?.evidence ?? []),
    ...(jobs?.value?.evidence ?? []),
    ...(dns.value?.evidence ?? []),
    ...(crt.value?.evidence ?? []),
    ...(hn?.value?.evidence ?? []),
    ...(rss?.value?.evidence ?? []),
    ...(web?.value?.evidence ?? []),
  ];
  const sources: SourceRef[] = [
    ...(gcol?.sources ?? []),
    ...(jobs?.value?.sources ?? []),
    ...(dns.value?.sources ?? []),
    ...(crt.value?.sources ?? []),
    ...(hn?.value?.sources ?? []),
    ...(rss?.value?.sources ?? []),
    ...(web?.value?.sources ?? []),
  ];
  log(job.id, `collected: ${Object.entries(status).map(([k, v]) => `${k}=${v.status}`).join(" ")}; ${evidence.length} evidence items`);

  const limitations: string[] = [
    "Public repositories, job postings, DNS records and articles show only part of a company's technology stack; private repositories and internal systems are not visible.",
    ...(gcol?.notes ?? []),
  ];
  if (!gh.authenticated) limitations.push("GitHub was queried without a token (60 requests/hour), so coverage is reduced. Add GITHUB_TOKEN.");
  if (ident.method === "name_match_unconfirmed") limitations.push(ident.note);
  if (status.crtsh?.status === "error") limitations.push("Certificate Transparency (crt.sh) did not respond in time; subdomain tooling was not checked this run.");

  // Save sources discovered automatically back onto the company row (only where empty).
  const discovered: Record<string, string> = {};
  if (jobs?.value?.discovered && !company.job_board_provider) Object.assign(discovered, { job_board_provider: jobs.value.discovered.provider, job_board_slug: jobs.value.discovered.slug });
  if (rss?.value?.discovered && !company.blog_rss_url) discovered.blog_rss_url = rss.value.discovered;

  // ---------------------------------------------------------------- 2. Store sources + findings
  checkDeadline("evidence collection");
  const uniqueSources = [...new Map(sources.map((s) => [s.url, s])).values()];
  const sourceIds = new Map<string, string>();
  for (let i = 0; i < uniqueSources.length; i += 200) {
    const chunk = uniqueSources.slice(i, i + 200).map((s) => ({
      company_id: company.id,
      url: s.url,
      source_type: s.type,
      title: s.title?.slice(0, 500) ?? null,
      published_at: s.publishedAt,
      last_collected_at: nowIso,
      metadata: s.metadata ?? {},
    }));
    const rows = check(await db().from("research_sources").upsert(chunk, { onConflict: "company_id,url" }).select("id, url"), "Saving sources") as { id: string; url: string }[];
    rows.forEach((r) => sourceIds.set(r.url, r.id));
  }
  const findingRows = new Map<string, Record<string, unknown>>();
  for (const e of evidence) {
    const sourceId = sourceIds.get(e.source.url);
    if (!sourceId) continue;
    const k = `${sourceId}|${e.technology}`;
    if (findingRows.has(k)) continue;
    findingRows.set(k, {
      company_id: company.id,
      source_id: sourceId,
      technology: e.technology,
      category: e.category,
      evidence_kind: e.kind,
      evidence: e.evidence.slice(0, 1000),
      detail: e.detail ?? {},
      last_observed_at: nowIso,
      last_job_id: job.id,
    });
  }
  const findingList = [...findingRows.values()];
  for (let i = 0; i < findingList.length; i += 300) {
    check(await db().from("research_findings").upsert(findingList.slice(i, i + 300), { onConflict: "company_id,source_id,technology" }), "Saving findings");
  }
  const firstRows = check(await db().from("research_findings").select("technology, category, first_observed_at").eq("company_id", company.id), "Loading findings history") as {
    technology: string;
    category: string;
    first_observed_at: string;
  }[];
  const firstObserved = new Map<string, string>();
  for (const r of firstRows) {
    const k = techKey(r.category as never, r.technology);
    const cur = firstObserved.get(k);
    if (!cur || r.first_observed_at < cur) firstObserved.set(k, r.first_observed_at);
  }

  // ---------------------------------------------------------------- 3. Stack, scores, confidence
  const languages = gcol?.languages ?? [];
  const recentLanguages = gcol?.recentLanguages ?? [];
  const stack = buildStack(evidence, languages, firstObserved, nowIso, hiring);
  const act = activityScore(activity, hiring);
  const fit = fitScore(profile, stack, recentLanguages, languages, hiring);
  const breakdown = { activity: act.components, fit: fit.components };
  const confidence = scoreConfidence({ githubMethod: ident.method, reposAnalyzed: activity.repos_analyzed, evidence, now });

  const missing: string[] = [];
  for (const cat of CATEGORY_ORDER) if (!stack.some((s) => s.category === cat)) missing.push(`${CATEGORY_LABELS[cat]}: not publicly found`);
  if (activity.repos_listed === 0) missing.push("Recent engineering activity: not publicly found");
  for (const [k, s] of Object.entries(status)) if (s.status === "not_found" || s.status === "error") missing.push(`${SOURCE_LABELS[k as SourceKey]}: ${s.message}`);

  // ---------------------------------------------------------------- 4. Gemini insight
  const input: ReportInput = {
    company: { name: company.name, domain: company.domain },
    product: profile,
    identification: ident,
    stack,
    recentLanguages,
    activity,
    hiring,
    dns: dnsInfo,
    subdomains,
    blogPosts,
    hnStories,
    webResearch,
    scores: { activity: act.score, fit: fit.score, breakdown },
    trend: { previousActivityScore: prev?.activity_score ?? null, previousEngRoles: hiring.previous_eng_open_roles, previousCapturedAt: prev?.captured_at ?? null },
    sourceSummary: Object.entries(status).map(([k, s]) => `${SOURCE_LABELS[k as SourceKey]}: ${s.status} — ${s.message}`),
    limitations,
  };
  const facts = buildFacts(input);
  let insight: InsightOutput;
  let aiModel: string | null = null;
  let aiAttempts: number | null = null;
  const usage = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 };

  const hasEvidence = stack.length > 0 || activity.repos_listed > 0 || hiring.eng_open_roles > 0 || blogPosts.length > 0 || hnStories.length > 0;
  if (!hasEvidence) {
    insight = insufficientEvidenceInsight(input);
  } else {
    let errors: string[] = [];
    let accepted: ReturnType<typeof validateAiReport> | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      checkDeadline("AI insight");
      aiAttempts = attempt;
      const res = await geminiJson({
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(input, facts, errors),
        responseSchema: geminiResponseSchema as unknown as Record<string, unknown>,
        temperature: attempt === 1 ? 0.4 : 0.2,
      });
      aiModel = res.model;
      for (const k of Object.keys(usage) as (keyof typeof usage)[]) usage[k] += res.usage[k];
      let json: unknown;
      try {
        json = JSON.parse(res.text);
      } catch {
        errors = ["The response was not valid JSON."];
        continue;
      }
      const v = validateAiReport(json, facts, stack, profile.product_name);
      if (v.ok) {
        accepted = v;
        break;
      }
      errors = v.errors;
      log(job.id, `gemini attempt ${attempt} rejected: ${errors.join(" | ")}`);
    }
    if (!accepted || !accepted.ok) throw new Error(`Gemini's insight failed validation after 3 attempts: ${errors.slice(0, 3).join("; ")}`);
    insight = toInsight(accepted.report, ident.method === "name_match_unconfirmed");
    for (const l of accepted.report.limitations) if (!limitations.includes(l)) limitations.push(l);
  }

  // ---------------------------------------------------------------- 5. Snapshot + insight + diff
  checkDeadline("saving the snapshot");
  const version = (prev?.version ?? 0) + 1;
  const diffOf = (s: { github_identification: GithubIdentification; infra_signals: typeof stack; recent_languages: typeof languages; languages: typeof languages; activity: typeof activity; hiring: typeof hiring }): DiffInput => ({
    githubLogin: s.github_identification?.login ?? null,
    stack: s.infra_signals ?? [],
    languages: s.recent_languages?.length ? s.recent_languages : (s.languages ?? []),
    activity: s.activity ?? emptyActivity(),
    hiring: s.hiring ?? emptyHiring(),
  });
  const changes = prev
    ? diffSnapshots(diffOf(prev), diffOf({ github_identification: ident, infra_signals: stack, recent_languages: recentLanguages, languages, activity, hiring }), nowIso)
    : [];

  const snapshot = check(
    await db()
      .from("company_snapshots")
      .insert({
        company_id: company.id,
        job_id: job.id,
        run_id: job.run_id,
        version,
        captured_at: nowIso,
        languages,
        recent_languages: recentLanguages,
        infra_signals: stack,
        activity,
        hiring,
        dns: dnsInfo,
        subdomains,
        hn_stories: hnStories,
        blog_posts: blogPosts,
        web_research: webResearch,
        activity_score: act.score,
        fit_score: fit.score,
        score_breakdown: breakdown,
        confidence,
        source_status: status,
        github_identification: ident,
        evidence_facts: facts.map(({ anchors: _a, ...f }) => f),
        limitations,
        missing_information: missing,
        sources_analyzed: uniqueSources.length,
        changes,
        previous_snapshot_id: prev?.id ?? null,
      })
      .select("id")
      .single(),
    "Saving snapshot",
  ) as { id: string };

  check(
    await db().from("company_insights").insert({
      company_id: company.id,
      snapshot_id: snapshot.id,
      summary: insight.summary,
      outreach_line: insight.outreachLine,
      outreach_rationale: insight.outreachRationale,
      talking_points: insight.talkingPoints,
      outreach: insight.outreach,
      interpretations: insight.interpretations,
      model: aiModel,
      ai_attempts: aiAttempts,
      ai_usage: aiModel ? usage : null,
    }),
    "Saving insight",
  );

  check(
    await db()
      .from("companies")
      .update({
        ...discovered,
        research_status: "completed",
        last_researched_at: nowIso,
        next_refresh_at: new Date(now + settings.refresh_interval_days * 86_400_000).toISOString(),
        last_error: null,
        detected_github_org: ident.login,
        detected_github_org_method: ident.method === "none" ? null : ident.method,
      })
      .eq("id", company.id),
    "Updating company",
  );

  log(job.id, `done: v${version}, ${stack.length} technologies, activity ${act.score}, fit ${fit.score}, ${uniqueSources.length} sources, confidence ${confidence.level}`);
  return { snapshotId: snapshot.id };
}
