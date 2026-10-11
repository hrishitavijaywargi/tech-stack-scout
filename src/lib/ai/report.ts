import { z } from "zod";
import { detectInText } from "@/lib/techDictionary";
import {
  CATEGORY_LABELS,
  EVIDENCE_KIND_LABELS,
  type Activity,
  type BlogPost,
  type DnsInfo,
  type GithubIdentification,
  type Hiring,
  type HnStory,
  type Interpretation,
  type LanguageShare,
  type OutreachResult,
  type ProductProfile,
  type ScoreBreakdown,
  type StackItem,
  type Subdomains,
  type TalkingPoint,
  type WebResearch,
} from "@/lib/types";

/**
 * Builds the compact evidence pack for Gemini (never raw API dumps), and validates Gemini's
 * JSON against a schema AND against the evidence: citations must exist, no technologies outside
 * the evidence, no placeholders/brackets/banned phrases, the outreach line must name a cited
 * finding. Invalid answers are retried with the validation errors as corrective feedback.
 */

export interface EvidenceFact {
  id: string;
  type: "technology" | "release" | "repository" | "activity" | "hiring" | "job_posting" | "dns" | "subdomain" | "article" | "web";
  text: string;
  url: string | null;
  date: string | null;
  /** Words that, if present in the outreach line, show it really references this fact. */
  anchors: string[];
}

export interface Trend {
  previousActivityScore: number | null;
  previousEngRoles: number | null;
  previousCapturedAt: string | null;
}

export interface ReportInput {
  company: { name: string; domain: string | null };
  product: Pick<ProductProfile, "product_name" | "one_liner" | "description" | "target_languages" | "target_clouds" | "target_signals">;
  identification: GithubIdentification;
  stack: StackItem[];
  recentLanguages: LanguageShare[];
  activity: Activity;
  hiring: Hiring;
  dns: DnsInfo;
  subdomains: Subdomains;
  blogPosts: BlogPost[];
  hnStories: HnStory[];
  webResearch: WebResearch;
  scores: { activity: number; fit: number; breakdown: ScoreBreakdown };
  trend: Trend;
  sourceSummary: string[];
  limitations: string[];
}

const words = (s: string, min = 4) => s.split(/[\s,:/()"“”'-]+/).filter((w) => w.length >= min);

export function buildFacts(input: ReportInput): EvidenceFact[] {
  const facts: EvidenceFact[] = input.stack.map((s) => ({
    id: s.id,
    type: "technology",
    text: `${s.tech} [${CATEGORY_LABELS[s.category]}] — ${s.confidence} confidence (${s.confidenceReason})${s.pct !== undefined ? `, ${s.pct}% of public code` : ""}. e.g. ${s.evidence[0]?.detail ?? ""}`,
    url: s.evidence[0]?.url ?? null,
    date: s.lastObservedAt,
    anchors: [s.tech, ...s.tech.split(/[\s()]+/).filter((w) => w.length >= 3)],
  }));

  const a = input.activity;
  if (a.repos_listed > 0) {
    const trend = input.trend.previousActivityScore !== null ? ` (previous snapshot ${input.trend.previousActivityScore})` : "";
    facts.push({
      id: "M1",
      type: "activity",
      text: `GitHub activity ${a.level}; activity score ${input.scores.activity}/100${trend}. ${a.repos_active_30d} repos pushed in 30 days, ${a.repos_active_90d} in 90 days; ${a.commits_90d ?? "unknown"} commits in 90 days across ${a.commit_repos_sampled} sampled repos; ${a.contributors ?? "unknown"} contributors; ${a.releases_90d} releases in 90 days.`,
      url: a.org_url,
      date: a.last_push_at,
      anchors: ["repositor", "commit", "contributor", "release", "open source", "open-source", "GitHub"],
    });
    a.most_active_repos.slice(0, 3).forEach((r, i) =>
      facts.push({
        id: `M${i + 2}`,
        type: "activity",
        text: `Recently active repository ${r.name} (last push ${r.pushed_at.slice(0, 10)}${r.commits_52w !== null ? `, ${r.commits_52w} commits in 52 weeks` : ""})`,
        url: r.url,
        date: r.pushed_at,
        anchors: [r.name.split("/")[1]],
      }),
    );
  }
  a.releases.slice(0, 6).forEach((r, i) =>
    facts.push({ id: `R${i + 1}`, type: "release", text: `Release ${r.tag} of ${r.repo} published ${r.publishedAt.slice(0, 10)}`, url: r.url, date: r.publishedAt, anchors: [r.repo.split("/")[1], r.tag].filter(Boolean) }),
  );
  a.new_repos_90d.slice(0, 4).forEach((r, i) =>
    facts.push({ id: `N${i + 1}`, type: "repository", text: `New public repository ${r.name} created ${r.created_at.slice(0, 10)}`, url: r.url, date: r.created_at, anchors: [r.name.split("/")[1]] }),
  );

  const h = input.hiring;
  if (h.provider) {
    const trend = input.trend.previousEngRoles !== null ? ` (previous snapshot: ${input.trend.previousEngRoles})` : "";
    facts.push({
      id: "H1",
      type: "hiring",
      text: `${h.eng_open_roles} open engineering roles of ${h.total_open_roles} total on ${h.provider}${trend}. Most-mentioned technologies: ${h.tech_mentions.slice(0, 8).map((t) => `${t.tech} (${t.count})`).join(", ") || "none"}.`,
      url: h.board_url,
      date: null,
      anchors: ["hiring", "roles", "open role", "job", "postings", ...h.tech_mentions.slice(0, 5).map((t) => t.tech)],
    });
    h.sample_roles.forEach((r, i) =>
      facts.push({ id: `J${i + 1}`, type: "job_posting", text: `Open role "${r.title}"${r.team ? ` (${r.team})` : ""} mentioning ${r.techs.join(", ") || "no specific technologies"}`, url: r.url, date: null, anchors: words(r.title) }),
    );
  }

  const d = input.dns;
  if (d.hosting.length) facts.push({ id: "D1", type: "dns", text: `DNS hosting/CDN: ${d.hosting.map((x) => `${x.provider} (${x.record})`).join("; ")}`, url: null, date: null, anchors: d.hosting.map((x) => x.provider) });
  if (d.email_provider || d.saas_verifications.length)
    facts.push({
      id: "D2",
      type: "dns",
      text: `Email: ${d.email_provider ?? "unknown"}. SaaS verification records: ${d.saas_verifications.map((v) => v.service).join(", ") || "none"}.`,
      url: null,
      date: null,
      anchors: [d.email_provider ?? "", ...d.saas_verifications.map((v) => v.service)].filter(Boolean),
    });
  if (input.subdomains.tooling.length)
    facts.push({
      id: "S1",
      type: "subdomain",
      text: `${input.subdomains.count} subdomains in certificate logs; tooling-revealing: ${input.subdomains.tooling.map((t) => `${t.subdomain} (${t.tool})`).slice(0, 8).join(", ")}`,
      url: null,
      date: null,
      anchors: input.subdomains.tooling.map((t) => t.tool),
    });

  const articles = [
    ...input.blogPosts.filter((p) => p.technical).map((p) => ({ title: p.title, url: p.link, date: p.date, src: "engineering blog" })),
    ...input.hnStories.map((s) => ({ title: s.title, url: s.url, date: s.date, src: `Hacker News, ${s.points} points` })),
  ].slice(0, 5);
  articles.forEach((ar, i) => facts.push({ id: `A${i + 1}`, type: "article", text: `“${ar.title}” (${ar.src})`, url: ar.url, date: ar.date, anchors: words(ar.title, 5) }));

  input.webResearch.findings.forEach((f, i) =>
    facts.push({ id: `W${i + 1}`, type: "web", text: `Web research (${f.type}): “${f.title}” — ${f.summary}`, url: f.url, date: f.date, anchors: words(f.title, 5) }),
  );
  return facts;
}

// ------------------------------------------------------------------ output schema

export const aiReportSchema = z.object({
  summary_paragraph_1: z.string().min(150).max(1500),
  summary_paragraph_2: z.string().min(150).max(1500),
  summary_cited_ids: z.array(z.string()).min(1),
  outreach: z.object({
    status: z.enum(["ready", "insufficient_evidence"]),
    line: z.string().max(400),
    rationale: z.string().max(600),
    referenced_ids: z.array(z.string()),
    insufficient_reason: z.string().max(600),
    suggested_research: z.array(z.string().max(250)).max(5),
  }),
  talking_points: z.array(z.object({ point: z.string().min(10).max(300), evidence_ids: z.array(z.string()) })).min(1).max(3),
  interpretations: z.array(z.object({ statement: z.string().min(10).max(400), type: z.enum(["observation", "hypothesis"]), supporting_ids: z.array(z.string()) })).max(8),
  limitations: z.array(z.string().max(300)).max(6),
});
export type AiReport = z.infer<typeof aiReportSchema>;

export const geminiResponseSchema = {
  type: "OBJECT",
  properties: {
    summary_cited_ids: { type: "ARRAY", items: { type: "STRING" } },
    summary_paragraph_1: { type: "STRING", description: "Paragraph 1: how they build (languages, architecture, cloud/infra, tooling) with concrete evidence." },
    summary_paragraph_2: { type: "STRING", description: "Paragraph 2: engineering momentum (activity, hiring, initiatives) and what it implies for the product." },
    talking_points: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { point: { type: "STRING" }, evidence_ids: { type: "ARRAY", items: { type: "STRING" } } }, required: ["point", "evidence_ids"] },
    },
    interpretations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { statement: { type: "STRING" }, type: { type: "STRING", enum: ["observation", "hypothesis"] }, supporting_ids: { type: "ARRAY", items: { type: "STRING" } } },
        required: ["statement", "type", "supporting_ids"],
      },
    },
    outreach: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", enum: ["ready", "insufficient_evidence"] },
        referenced_ids: { type: "ARRAY", items: { type: "STRING" } },
        line: { type: "STRING" },
        rationale: { type: "STRING" },
        insufficient_reason: { type: "STRING" },
        suggested_research: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["status", "line", "rationale", "referenced_ids", "insufficient_reason", "suggested_research"],
      propertyOrdering: ["status", "referenced_ids", "line", "rationale", "insufficient_reason", "suggested_research"],
    },
    limitations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary_paragraph_1", "summary_paragraph_2", "summary_cited_ids", "talking_points", "interpretations", "outreach", "limitations"],
  propertyOrdering: ["summary_cited_ids", "summary_paragraph_1", "summary_paragraph_2", "talking_points", "interpretations", "outreach", "limitations"],
} as const;

// ------------------------------------------------------------------ prompt

export const SYSTEM_PROMPT = `You are a meticulous B2B sales research analyst. You turn verified public engineering evidence into a pre-call brief for an enterprise account executive who sells a developer productivity tool.

Hard rules:
- Only state facts present in the EVIDENCE list. Never invent repos, tools, people, customers, numbers, incidents or internal practices.
- Cite fact IDs (F1, M1, H1, J2, D1, S1, A1, W1, R1…) in the *_ids arrays for every claim. Only cite IDs that exist.
- Never write fact IDs inside summary paragraphs, the outreach line, rationale or talking points; put them only in the *_ids arrays. The reader is a salesperson.
- Hedge low-confidence signals ("appears to", "job postings suggest"). Medium/high confidence may be stated plainly.
- Public repositories, postings, DNS and articles show only part of a company's stack. Say so where it matters; never present public code as the full internal stack.
- Distinguish observation (in the evidence) from hypothesis (your inference: "may", "suggests", "could").
- If evidence is thin, say so plainly instead of padding.
- Name a technology only if it is in the EVIDENCE list. When describing the seller's product, use the product's name in that sentence and do not name technologies the company has not been observed using.
- Plain text only: no markdown, no bullet characters, no line breaks inside a paragraph.`;

export function buildPrompt(input: ReportInput, facts: EvidenceFact[], previousErrors: string[] = []) {
  const id = input.identification;
  const p = input.product;
  const lines = [
    `COMPANY: ${input.company.name}${input.company.domain ? ` (${input.company.domain})` : ""}`,
    `GITHUB IDENTIFICATION: ${id.login ? `${id.login} — ${id.note}` : id.note}`,
    `SCORES (computed in code): activity ${input.scores.activity}/100, product fit ${input.scores.fit}/100 (${input.scores.breakdown.fit.map((c) => `${c.name} ${c.points}/${c.max}: ${c.detail}`).join("; ")})`,
    `RECENT LANGUAGE MIX (repos pushed in last 180 days): ${input.recentLanguages.slice(0, 6).map((l) => `${l.name} ${l.pct}%`).join(", ") || "not available"}`,
    "",
    `SELLER'S PRODUCT: ${p.product_name} — ${p.one_liner} ${p.description}`,
    `Best-fit targets: languages ${p.target_languages.join(", ")}; clouds ${p.target_clouds.join(", ")}; signals ${p.target_signals.join(", ")}.`,
    "",
    "SOURCE COVERAGE:",
    ...input.sourceSummary.map((s) => `- ${s}`),
    "",
    "EVIDENCE (the only facts you may use):",
    ...facts.map((f) => `${f.id} | ${f.type} | ${f.date?.slice(0, 10) ?? "undated"} | ${f.text}`),
    "",
    "KNOWN LIMITATIONS:",
    ...input.limitations.map((l) => `- ${l}`),
    "",
    "WRITE:",
    `1. summary_paragraph_1 (70–160 words): how ${input.company.name} builds — main languages (with shares), architecture, cloud/infrastructure, tooling — citing concrete evidence. Specific to this company.`,
    `2. summary_paragraph_2 (70–160 words): engineering momentum (activity and its trend, hiring and which technologies the postings ask for, recent initiatives/migrations/releases) and what that implies for ${p.product_name}. Mark observations vs hypotheses explicitly.`,
    `3. talking_points: exactly 3 short evidence-backed points for the call, each with evidence_ids.`,
    `4. outreach: ONE sentence under 35 words for a first message. It MUST reference at least one concrete company-specific detail by name (a repo, release, job posting's stack, blog post title, migration, or a measurable activity fact) and connect it to ${p.product_name}'s value. No generic templates ("I noticed your company is growing", "I hope this finds you well"), no compliments, no placeholders or brackets, no claim that they have a problem, no pretending to know internal processes. Put the IDs it relies on in referenced_ids and explain which evidence it uses in rationale. If evidence is too thin (or the GitHub match is unconfirmed and nothing else is solid) set status "insufficient_evidence", leave line empty, explain why in insufficient_reason and list next research steps in suggested_research.`,
    "5. interpretations: up to 6 statements, each typed observation or hypothesis, with supporting_ids.",
    "6. limitations: up to 4 report-specific limitations.",
  ];
  if (previousErrors.length) lines.push("", "YOUR PREVIOUS ANSWER WAS REJECTED BY VALIDATION. Fix all of these:", ...previousErrors.map((e) => `- ${e}`));
  return lines.join("\n");
}

// ------------------------------------------------------------------ validation

const GENERIC =
  /\b(hope (this|you)|i noticed your company is growing|came across|impressive|love what (you|your)|reach(ing)? out to (introduce|connect)|quick question|synergy|game[- ]?chang|cutting[- ]edge|world[- ]class|innovative)\b/i;
const PLACEHOLDER = /[[\]{}<>]|\b(FirstName|First Name|CompanyName|\{\{)/;
const PROBLEM_CLAIM = /\b(struggl\w*|pain ?points?|painful|frustrat\w*|bottleneck\w*|broken|suffer\w*|slow builds?)\b/i;
const NEGATION = /\b(no|not|without|absence|absent|unclear|unknown|lack|none|neither|nor)\b/i;

const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);

/** Remove citation IDs like "(F1, F2)" or "[R1]" that leaked into prose. */
export function stripCitations(text: string) {
  return text
    .replace(/\s*[([]\s*(?:[FRNMJADSWH]\d+\s*[,;]?\s*)+[)\]]/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Technologies mentioned in text that are not in the evidence (ignoring negated and product sentences). */
export function unsupportedTechMentions(text: string, stack: Pick<StackItem, "tech">[], productName?: string) {
  const known = stack.map((s) => s.tech.toLowerCase());
  const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const isKnown = (name: string) => {
    const n = name.toLowerCase();
    const word = new RegExp(`(^|[^a-z0-9])${escape(n)}([^a-z0-9]|$)`);
    return known.some((k) => k === n || word.test(k) || new RegExp(`(^|[^a-z0-9])${escape(k)}([^a-z0-9]|$)`).test(n));
  };
  const out = new Set<string>();
  for (const s of sentences(text)) {
    if (NEGATION.test(s)) continue;
    if (productName && s.toLowerCase().includes(productName.toLowerCase())) continue;
    for (const m of detectInText(s)) if (!isKnown(m.def.name)) out.add(m.def.name);
  }
  return [...out];
}

export function validateAiReport(raw: unknown, facts: EvidenceFact[], stack: Pick<StackItem, "tech">[], productName?: string): { ok: true; report: AiReport } | { ok: false; errors: string[] } {
  const parsed = aiReportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "root"}: ${i.message}`) };
  const r = parsed.data;
  const errors: string[] = [];
  const ids = new Set(facts.map((f) => f.id));
  const bad = (list: string[]) => list.filter((x) => !ids.has(x));

  for (const [k, p] of [["summary_paragraph_1", r.summary_paragraph_1], ["summary_paragraph_2", r.summary_paragraph_2]] as const) {
    if (/\n/.test(p.trim())) errors.push(`${k} must be a single paragraph without line breaks.`);
    if (/(^|\n)\s*([-*•]|\d+\.)\s|(^|\n)\s*#{1,6}\s|\*\*/.test(p)) errors.push(`${k} must be plain prose (no markdown or bullets).`);
    const unsupported = unsupportedTechMentions(p, stack, productName);
    if (unsupported.length) errors.push(`${k} mentions ${unsupported.join(", ")}, which is not in the evidence. Remove it or state it was not found.`);
  }
  const badSummary = bad(r.summary_cited_ids);
  if (badSummary.length) errors.push(`summary_cited_ids contains unknown IDs: ${badSummary.join(", ")}.`);
  r.talking_points.forEach((t, i) => {
    if (!t.evidence_ids.length) errors.push(`talking_points[${i}] needs evidence_ids.`);
    const b = bad(t.evidence_ids);
    if (b.length) errors.push(`talking_points[${i}] cites unknown IDs: ${b.join(", ")}.`);
    if (PLACEHOLDER.test(stripCitations(t.point))) errors.push(`talking_points[${i}] contains brackets or placeholders.`);
  });
  for (const it of r.interpretations) {
    const b = bad(it.supporting_ids);
    if (b.length) errors.push(`interpretation "${it.statement.slice(0, 40)}…" cites unknown IDs: ${b.join(", ")}.`);
    if (it.type === "observation" && it.supporting_ids.length === 0) errors.push(`Observation "${it.statement.slice(0, 40)}…" needs supporting_ids.`);
  }

  const o = r.outreach;
  if (o.status === "ready") {
    const line = stripCitations(o.line);
    if (line.length < 40) errors.push("outreach.line is too short or empty.");
    if (line.split(/\s+/).length >= 35) errors.push("outreach.line must be one sentence under 35 words.");
    if (PLACEHOLDER.test(line)) errors.push("outreach.line contains a placeholder or brackets.");
    if (GENERIC.test(line)) errors.push("outreach.line uses a generic phrase or compliment; reference the specific finding instead.");
    if (PROBLEM_CLAIM.test(line)) errors.push("outreach.line claims the company has a problem; the evidence does not show that.");
    if (!o.referenced_ids.length) errors.push("outreach.referenced_ids must cite at least one fact.");
    const b = bad(o.referenced_ids);
    if (b.length) errors.push(`outreach.referenced_ids contains unknown IDs: ${b.join(", ")}.`);
    if (!o.rationale.trim()) errors.push("outreach.rationale must say which evidence the line uses.");
    const refs = facts.filter((f) => o.referenced_ids.includes(f.id));
    const lower = line.toLowerCase();
    if (refs.length && !refs.some((f) => f.anchors.some((a) => a && lower.includes(a.toLowerCase())))) {
      errors.push(`outreach.line must name the specific finding it references (e.g. "${refs[0].anchors[0]}").`);
    }
    const unsupported = unsupportedTechMentions(line, stack);
    if (unsupported.length) errors.push(`outreach.line mentions ${unsupported.join(", ")}, which is not in the evidence.`);
  } else {
    if (!o.insufficient_reason.trim()) errors.push("outreach.insufficient_reason is required when status is insufficient_evidence.");
    if (!o.suggested_research.length) errors.push("outreach.suggested_research needs at least one next step.");
  }
  return errors.length ? { ok: false, errors } : { ok: true, report: r };
}

export interface InsightOutput {
  summary: string;
  outreachLine: string | null;
  outreachRationale: string;
  talkingPoints: TalkingPoint[];
  outreach: OutreachResult;
  interpretations: Interpretation[];
}

export function toInsight(r: AiReport, needsVerification: boolean): InsightOutput {
  const ready = r.outreach.status === "ready";
  return {
    summary: `${stripCitations(r.summary_paragraph_1)}\n\n${stripCitations(r.summary_paragraph_2)}`,
    outreachLine: ready ? stripCitations(r.outreach.line) : null,
    outreachRationale: stripCitations(ready ? r.outreach.rationale : r.outreach.insufficient_reason),
    talkingPoints: r.talking_points.map((t) => ({ point: stripCitations(t.point), evidence_ids: t.evidence_ids })),
    outreach: {
      status: r.outreach.status,
      referencedIds: r.outreach.referenced_ids,
      needsVerification,
      insufficientReason: r.outreach.insufficient_reason.trim(),
      suggestedResearch: r.outreach.suggested_research,
    },
    interpretations: r.interpretations.map((i) => ({ statement: stripCitations(i.statement), type: i.type, supportingIds: i.supporting_ids })),
  };
}

/** Deterministic insight when there is no evidence at all — no AI call, nothing invented. */
export function insufficientEvidenceInsight(input: ReportInput): InsightOutput {
  const p1 = `Insufficient public evidence. No programming languages, frameworks, cloud platforms or infrastructure tools could be traced to public sources for ${input.company.name}. ${input.identification.note}`;
  const p2 = `Engineering momentum: not publicly found. Without verified evidence this brief makes no claims about how ${input.company.name} builds software, and no hypothesis about its relevance to ${input.product.product_name} can be supported yet. Adding the GitHub organization, job board and engineering blog feed on the company row and refreshing is the quickest way to improve coverage.`;
  return {
    summary: `${p1}\n\n${p2}`,
    outreachLine: null,
    outreachRationale: "No verified technology or engineering-activity evidence was found, so any personalised opening would be invented.",
    talkingPoints: [],
    outreach: {
      status: "insufficient_evidence",
      referencedIds: [],
      needsVerification: false,
      insufficientReason: "No verified technology or engineering-activity evidence was found.",
      suggestedResearch: ["Confirm the company's GitHub organization (or that it has none).", "Set job_board_provider/job_board_slug if it uses Greenhouse, Lever or Ashby.", "Add the engineering blog RSS URL."],
    },
    interpretations: [],
  };
}

export { EVIDENCE_KIND_LABELS };
