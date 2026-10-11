import "server-only";
import { env } from "@/lib/env";
import { db, check } from "@/lib/supabase/server";
import { RateLimitError } from "@/lib/http";
import { getCompany, getSettings, latestSnapshot, supabaseHttpCache } from "@/lib/data";
import { GitHubClient, collectGithub, emptyActivity, identifyGithubOrg } from "@/lib/sources/github";
import { collectJobPostings } from "@/lib/sources/jobs";
import { collectBlog, collectHackerNews, type Article } from "@/lib/sources/articles";
import { buildSnapshot, buildStack, diffSnapshots, scoreConfidence, techKey } from "@/lib/research/analysis";
import { geminiJson } from "@/lib/ai/gemini";
import {
  SYSTEM_PROMPT,
  buildFacts,
  buildPrompt,
  geminiResponseSchema,
  insufficientEvidenceReport,
  stripCitations,
  toInterpretations,
  toOutreach,
  validateAiReport,
  type ReportInput,
} from "@/lib/ai/report";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ActivityMetrics,
  type EvidenceItem,
  type GithubIdentification,
  type Interpretation,
  type LanguageShare,
  type OutreachResult,
  type ResearchJob,
  type SourceRef,
  type SourceStatus,
} from "@/lib/types";

export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

const log = (jobId: string, msg: string) => console.log(`[research ${jobId.slice(0, 8)}] ${msg}`);

/**
 * The single research pipeline used by manual, bulk and scheduled refreshes:
 * identify → collect (GitHub, job boards, blog feed, Hacker News) → store sources/findings →
 * aggregate stack → score confidence → Gemini report (validated) → report + snapshot + diff.
 */
export async function runResearch(job: ResearchJob, deadline = Number.POSITIVE_INFINITY): Promise<{ reportId: string }> {
  // A run that overshoots its deadline stops before writing anything, so a timed-out job
  // can never save a late report after the queue has already marked it failed.
  const checkDeadline = (stage: string) => {
    if (Date.now() > deadline) throw new Error(`Research timed out (during ${stage})`);
  };
  const company = await getCompany(job.company_id);
  if (!company) throw new PermanentError("The company was removed from the watchlist.");
  const settings = await getSettings();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const statuses: SourceStatus[] = [];
  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  const limitations: string[] = [
    "Public repositories, job postings and articles show only part of a company's technology stack; internal systems and private code are not visible.",
  ];

  // ---------------------------------------------------------------- 1. GitHub
  const gh = new GitHubClient({ token: env().GITHUB_TOKEN, cache: supabaseHttpCache });
  let ident: GithubIdentification = { login: null, method: "none", profileUrl: null, displayName: null, blog: null, candidates: [], note: "" };
  let languages: LanguageShare[] = [];
  let activity: ActivityMetrics = emptyActivity();
  try {
    const found = await identifyGithubOrg(gh, company);
    ident = found.ident;
    if (found.profile) {
      const col = await collectGithub(gh, found.profile, { maxRepos: settings.max_repos, now });
      evidence.push(...col.evidence);
      sources.push(...col.sources);
      languages = col.languages;
      activity = col.activity;
      limitations.push(...col.notes);
      statuses.push({
        source: "GitHub",
        status: "ok",
        items: col.activity.reposAnalyzed,
        url: found.profile.html_url,
        detail: `${found.profile.login}: ${col.activity.reposListed} public repositories listed, ${col.activity.reposAnalyzed} analyzed in depth (${gh.requests} API requests, ${gh.cacheHits} served from cache).`,
      });
    } else {
      activity = emptyActivity("Not publicly found", ident.note);
      statuses.push({ source: "GitHub", status: "not_found", detail: ident.note });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    ident = { ...ident, note: `GitHub lookup failed: ${(err as Error).message}` };
    statuses.push({ source: "GitHub", status: "error", detail: ident.note });
  }
  if (!gh.authenticated) limitations.push("GitHub was queried without a token (60 requests/hour), so coverage may be reduced. Add GITHUB_TOKEN.");
  if (ident.method === "name_match_unconfirmed") limitations.push(ident.note);
  log(job.id, `github: ${ident.method} ${ident.login ?? "-"}, ${evidence.length} evidence items`);

  // ---------------------------------------------------------------- 2. Job postings
  let jobPostings: { title: string; url: string; publishedAt: string | null }[] = [];
  if (settings.include_job_boards) {
    const jobs = await collectJobPostings(company, ident.login);
    statuses.push(jobs.status);
    evidence.push(...jobs.evidence);
    sources.push(...jobs.sources);
    jobPostings = jobs.postings;
  } else statuses.push({ source: "Job postings", status: "skipped", detail: "Disabled in Settings." });

  // ---------------------------------------------------------------- 3. Articles
  const articles: Article[] = [];
  const domain = company.domain ?? null;
  if (settings.include_blogs) {
    const blog = await collectBlog({ domain, blog_url: company.blog_url }, { now });
    statuses.push(blog.status);
    evidence.push(...blog.evidence);
    sources.push(...blog.sources);
    articles.push(...blog.articles);
  } else statuses.push({ source: "Engineering blog", status: "skipped", detail: "Disabled in Settings." });

  if (settings.include_hacker_news) {
    const hn = await collectHackerNews({ domain }, { now });
    statuses.push(hn.status);
    const known = new Set(sources.map((s) => s.url));
    evidence.push(...hn.evidence.filter((e) => !known.has(e.source.url) || e.source.type === "hacker_news"));
    sources.push(...hn.sources.filter((s) => !known.has(s.url)));
    articles.push(...hn.articles.filter((a) => !articles.some((b) => b.url === a.url)));
  } else statuses.push({ source: "Hacker News", status: "skipped", detail: "Disabled in Settings." });

  statuses.push({
    source: "Developer talks",
    status: "not_collected",
    detail: "No reliable public API for conference talks is configured, so talks are not collected.",
  });

  // ---------------------------------------------------------------- 4. Store sources + findings
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
    const rows = check(await db().from("research_sources").upsert(chunk, { onConflict: "company_id,url" }).select("id, url"), "Saving sources") as {
      id: string;
      url: string;
    }[];
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

  // ---------------------------------------------------------------- 5. Aggregate + confidence
  const stack = buildStack(evidence, languages, firstObserved, nowIso);
  const confidence = scoreConfidence({ githubMethod: ident.method, reposAnalyzed: activity.reposAnalyzed, evidence, now });

  const missing: string[] = [];
  for (const cat of CATEGORY_ORDER) if (!stack.some((s) => s.category === cat)) missing.push(`${CATEGORY_LABELS[cat]}: not publicly found`);
  if (activity.reposListed === 0) missing.push("Recent engineering activity: not publicly found");
  for (const s of statuses) if (s.status === "not_found" || s.status === "error") missing.push(`${s.source}: ${s.detail}`);

  // ---------------------------------------------------------------- 6. Gemini report
  const input: ReportInput = {
    company: { name: company.name, domain },
    product: { name: settings.product_name, description: settings.product_description },
    identification: ident,
    stack,
    activity,
    jobPostings,
    articles: articles.map((a) => ({ title: a.title, url: a.url, publishedAt: a.publishedAt })),
    sourceStatuses: statuses,
    limitations,
  };

  const facts = buildFacts(input);
  let paragraphs: string[];
  let outreach: OutreachResult;
  let interpretations: Interpretation[] = [];
  let aiModel: string | null = null;
  let aiAttempts: number | null = null;
  const usage = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 };

  const hasEvidence = stack.length > 0 || activity.reposListed > 0 || jobPostings.length > 0 || articles.length > 0;
  if (!hasEvidence) {
    const fallback = insufficientEvidenceReport(input);
    paragraphs = fallback.paragraphs;
    outreach = fallback.outreach;
  } else {
    let errors: string[] = [];
    let accepted = null as ReturnType<typeof validateAiReport> | null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      checkDeadline("AI report");
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
      const v = validateAiReport(json, facts, stack, settings.product_name);
      if (v.ok) {
        accepted = v;
        break;
      }
      errors = v.errors;
      log(job.id, `gemini attempt ${attempt} rejected: ${errors.join(" | ")}`);
    }
    if (!accepted || !accepted.ok) throw new Error(`Gemini's report failed validation after 3 attempts: ${errors.slice(0, 3).join("; ")}`);
    const r = accepted.report;
    paragraphs = [stripCitations(r.summary_paragraph_1), stripCitations(r.summary_paragraph_2)];
    outreach = toOutreach(r, ident.method === "name_match_unconfirmed");
    interpretations = toInterpretations(r);
    for (const l of r.limitations) if (!limitations.includes(l)) limitations.push(l);
  }

  // ---------------------------------------------------------------- 7. Report + snapshot + diff
  checkDeadline("saving the report");
  const prev = await latestSnapshot(company.id);
  const versionRow = check(
    await db().from("research_reports").select("version").eq("company_id", company.id).order("version", { ascending: false }).limit(1).maybeSingle(),
    "Loading report version",
  ) as { version: number } | null;
  const version = (versionRow?.version ?? 0) + 1;

  const report = check(
    await db()
      .from("research_reports")
      .insert({
        company_id: company.id,
        job_id: job.id,
        version,
        summary_paragraphs: paragraphs,
        tech_stack: stack,
        engineering_activity: activity,
        outreach,
        interpretations,
        evidence_facts: facts.map(({ anchors: _a, ...f }) => f),
        confidence_level: confidence.level,
        confidence_score: confidence.score,
        confidence_breakdown: confidence,
        limitations,
        missing_information: missing,
        source_statuses: statuses,
        sources_analyzed: uniqueSources.length,
        github_identification: ident,
        ai_model: aiModel,
        ai_attempts: aiAttempts,
        ai_usage: aiModel ? usage : null,
      })
      .select("id")
      .single(),
    "Saving report",
  ) as { id: string };

  const snapshot = buildSnapshot(stack, languages, activity, evidence, ident.login);
  const changes = diffSnapshots(prev?.findings ?? null, snapshot, nowIso);
  check(
    await db().from("research_snapshots").insert({
      company_id: company.id,
      report_id: report.id,
      report_version: version,
      previous_snapshot_id: prev?.id ?? null,
      snapshot_at: nowIso,
      findings: snapshot,
      changes,
    }),
    "Saving snapshot",
  );

  check(
    await db()
      .from("companies")
      .update({
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

  log(job.id, `done: v${version}, ${stack.length} technologies, ${uniqueSources.length} sources, confidence ${confidence.level}`);
  return { reportId: report.id };
}
