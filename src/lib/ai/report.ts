import { z } from "zod";
import { detectInText } from "@/lib/research/catalog";
import {
  CATEGORY_LABELS,
  EVIDENCE_KIND_LABELS,
  type ActivityMetrics,
  type GithubIdentification,
  type Interpretation,
  type OutreachResult,
  type SourceStatus,
  type StackItem,
} from "@/lib/types";

/**
 * Turns collected evidence into the Gemini prompt, validates Gemini's JSON answer against a
 * schema AND against the evidence (citations must exist, no unsupported technologies, no
 * template placeholders), and retries with the validation errors when it fails.
 */

export interface EvidenceFact {
  id: string;
  type: "technology" | "release" | "repository" | "activity" | "job_posting" | "article";
  text: string;
  url: string | null;
  date: string | null;
  /** Words that, if present in the outreach line, show it really references this fact. */
  anchors: string[];
}

export interface ReportInput {
  company: { name: string; domain: string | null };
  product: { name: string; description: string };
  identification: GithubIdentification;
  stack: StackItem[];
  activity: ActivityMetrics;
  jobPostings: { title: string; url: string; publishedAt: string | null }[];
  articles: { title: string; url: string; publishedAt: string | null }[];
  sourceStatuses: SourceStatus[];
  limitations: string[];
}

export function buildFacts(input: ReportInput): EvidenceFact[] {
  const facts: EvidenceFact[] = input.stack.map((s) => ({
    id: s.id,
    type: "technology",
    text: `${s.technology} [${CATEGORY_LABELS[s.category]}] — ${EVIDENCE_KIND_LABELS[s.strongestKind]}${s.share !== undefined ? `, ${(s.share * 100).toFixed(1)}% of analyzed code` : ""}; ${s.evidenceCount} evidence item(s). e.g. ${s.evidence[0]?.text ?? ""}`,
    url: s.evidence[0]?.url ?? null,
    date: s.lastObservedAt,
    anchors: [s.technology, ...s.technology.split(/[\s()]+/).filter((w) => w.length >= 3)],
  }));
  const a = input.activity;
  a.releases180d.slice(0, 8).forEach((r, i) =>
    facts.push({
      id: `R${i + 1}`,
      type: "release",
      text: `Release ${r.tag} of ${r.repo} (“${r.name}”) published ${r.publishedAt.slice(0, 10)}`,
      url: r.url,
      date: r.publishedAt,
      anchors: [r.repo.split("/")[1], r.tag, r.name].filter(Boolean),
    }),
  );
  a.newRepos90d.slice(0, 6).forEach((r, i) =>
    facts.push({ id: `N${i + 1}`, type: "repository", text: `New public repository ${r.name} created ${r.createdAt.slice(0, 10)}`, url: r.url, date: r.createdAt, anchors: [r.name.split("/")[1]] }),
  );
  if (a.reposListed > 0) {
    facts.push({
      id: "M1",
      type: "activity",
      text: `GitHub activity: ${a.level}. ${a.reposPushed30d} repositories updated in the last 30 days, ${a.reposPushed90d} in 90 days; ${a.commits30d ?? 0}${a.commits30dCapped ? "+" : ""} commits by ${a.committers30d ?? 0} people across ${a.commitReposSampled} sampled repos in 30 days; last push ${a.lastPushAt?.slice(0, 10) ?? "unknown"}.`,
      url: a.orgUrl,
      date: a.lastPushAt,
      anchors: ["repositor", "commit", "open source", "open-source", "GitHub"],
    });
    a.mostActiveRepos.slice(0, 3).forEach((r, i) =>
      facts.push({
        id: `M${i + 2}`,
        type: "activity",
        text: `Recently active repository ${r.name} (last push ${r.pushedAt.slice(0, 10)}${r.commits30d !== null ? `, ${r.commits30d} commits in 30 days` : ""})`,
        url: r.url,
        date: r.pushedAt,
        anchors: [r.name.split("/")[1]],
      }),
    );
  }
  input.jobPostings.slice(0, 8).forEach((j, i) =>
    facts.push({ id: `J${i + 1}`, type: "job_posting", text: `Open engineering role: “${j.title}”`, url: j.url, date: j.publishedAt, anchors: j.title.split(/[\s,/()-]+/).filter((w) => w.length >= 4) }),
  );
  input.articles.slice(0, 10).forEach((ar, i) =>
    facts.push({ id: `A${i + 1}`, type: "article", text: `Published article: “${ar.title}”`, url: ar.url, date: ar.publishedAt, anchors: ar.title.split(/[\s,:/()-]+/).filter((w) => w.length >= 5) }),
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
    referenced_ids: z.array(z.string()),
    relevance: z.string().max(500),
    insufficient_reason: z.string().max(600),
    suggested_research: z.array(z.string().max(250)).max(5),
  }),
  interpretations: z
    .array(z.object({ statement: z.string().min(10).max(400), type: z.enum(["observation", "hypothesis"]), supporting_ids: z.array(z.string()) }))
    .max(8),
  limitations: z.array(z.string().max(300)).max(6),
});
export type AiReport = z.infer<typeof aiReportSchema>;

/** Same shape, in Gemini's OpenAPI-subset responseSchema format. */
export const geminiResponseSchema = {
  type: "OBJECT",
  properties: {
    summary_paragraph_1: { type: "STRING", description: "Paragraph 1: publicly visible engineering environment." },
    summary_paragraph_2: { type: "STRING", description: "Paragraph 2: recent activity, patterns, relevance to the product (observations vs hypotheses)." },
    summary_cited_ids: { type: "ARRAY", items: { type: "STRING" } },
    outreach: {
      type: "OBJECT",
      properties: {
        status: { type: "STRING", enum: ["ready", "insufficient_evidence"] },
        line: { type: "STRING" },
        referenced_ids: { type: "ARRAY", items: { type: "STRING" } },
        relevance: { type: "STRING" },
        insufficient_reason: { type: "STRING" },
        suggested_research: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["status", "line", "referenced_ids", "relevance", "insufficient_reason", "suggested_research"],
      propertyOrdering: ["status", "referenced_ids", "line", "relevance", "insufficient_reason", "suggested_research"],
    },
    interpretations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          statement: { type: "STRING" },
          type: { type: "STRING", enum: ["observation", "hypothesis"] },
          supporting_ids: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["statement", "type", "supporting_ids"],
      },
    },
    limitations: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary_paragraph_1", "summary_paragraph_2", "summary_cited_ids", "outreach", "interpretations", "limitations"],
  propertyOrdering: ["summary_cited_ids", "summary_paragraph_1", "summary_paragraph_2", "interpretations", "outreach", "limitations"],
} as const;

// ------------------------------------------------------------------ prompt

export const SYSTEM_PROMPT = `You are a meticulous B2B sales research analyst. You turn verified public engineering evidence into a short account brief for an enterprise account executive.

Hard rules:
- Use ONLY the facts in the EVIDENCE list. Never add technologies, numbers, people, customers, incidents or internal practices that are not in the evidence.
- Cite fact IDs (F1, R2, M1, J3, A1, …) for every claim in summary_cited_ids / referenced_ids / supporting_ids. Only cite IDs that exist.
- Public repositories, postings and articles show only part of a company's stack. Say so where it matters; never present public code as the full internal stack.
- Distinguish observation (directly in evidence) from hypothesis (your inference). Phrase hypotheses with "may", "suggests", "could".
- If a category has no evidence, say "not publicly found" rather than guessing.
- Plain text only: no markdown, no bullet points, no line breaks inside a paragraph.`;

export function buildPrompt(input: ReportInput, facts: EvidenceFact[], previousErrors: string[] = []) {
  const id = input.identification;
  const lines = [
    `COMPANY: ${input.company.name}${input.company.domain ? ` (${input.company.domain})` : ""}`,
    `GITHUB IDENTIFICATION: ${id.login ? `${id.login} — ${id.note}` : id.note}`,
    "",
    `SELLER'S PRODUCT: ${input.product.name} — ${input.product.description}`,
    "",
    "SOURCE COVERAGE:",
    ...input.sourceStatuses.map((s) => `- ${s.source}: ${s.status} — ${s.detail}`),
    "",
    "EVIDENCE (the only facts you may use):",
    ...facts.map((f) => `${f.id} | ${f.type} | ${f.date?.slice(0, 10) ?? "undated"} | ${f.text}`),
    "",
    "KNOWN LIMITATIONS:",
    ...input.limitations.map((l) => `- ${l}`),
    "",
    "WRITE:",
    `1. summary_paragraph_1 (70–160 words): ${input.company.name}'s publicly visible engineering environment — main languages (with shares if given), frameworks, cloud platforms, infrastructure/deployment tooling and architecture signals, each only where evidence exists. Be specific to this company; nothing that could describe any company.`,
    `2. summary_paragraph_2 (70–160 words): recent engineering activity (releases, new repositories, commit/push activity, hiring signals) and development patterns, then the potential relevance to ${input.product.name}. Mark observations vs hypotheses explicitly ("Observed: …", "Hypothesis: …" or equivalent wording).`,
    `3. outreach: ONE opening line (max ~40 words) for a first message from the account executive. It must name a specific, verified finding (a technology, repository, release or job posting from the evidence — use its actual name), connect it naturally to developer productivity / ${input.product.name}, sound conversational and professional. No generic compliments ("impressive", "love what you're doing"), no placeholders or brackets, no claim that they have a problem, no pretending to know internal processes. Put the IDs it relies on in referenced_ids and explain the link in relevance. If evidence is too thin or the GitHub identification is unconfirmed and there is nothing else solid, set status "insufficient_evidence", leave line empty, explain why in insufficient_reason and list concrete next research steps in suggested_research.`,
    "4. interpretations: up to 6 short statements, each typed observation or hypothesis, with supporting_ids.",
    "5. limitations: up to 4 report-specific limitations (coverage gaps, unconfirmed identification, sample size).",
  ];
  if (previousErrors.length) {
    lines.push("", "YOUR PREVIOUS ANSWER WAS REJECTED BY VALIDATION. Fix all of these:", ...previousErrors.map((e) => `- ${e}`));
  }
  return lines.join("\n");
}

// ------------------------------------------------------------------ validation

const GENERIC = /\b(hope (this|you)|i came across|impressive|love what (you|your)|reach(ing)? out to (introduce|connect)|quick question|synergy|game[- ]?chang|cutting[- ]edge|world[- ]class|innovative)\b/i;
const PLACEHOLDER = /[\[\]{}<>]|\b(FirstName|First Name|CompanyName|\{\{)/;
const PROBLEM_CLAIM = /\b(struggl\w*|pain ?points?|painful|frustrat\w*|bottleneck\w*|broken|suffer\w*|slow builds?)\b/i;
const NEGATION = /\b(no|not|without|absence|absent|unclear|unknown|lack|none|neither|nor)\b/i;

function sentences(text: string) {
  return text.split(/(?<=[.!?])\s+/);
}

/** Technologies mentioned in text that are not in the evidence (ignoring negated sentences). */
export function unsupportedTechMentions(text: string, stack: StackItem[], productName?: string) {
  const known = new Set(stack.map((s) => s.technology.toLowerCase()));
  const out = new Set<string>();
  for (const s of sentences(text)) {
    if (NEGATION.test(s)) continue;
    // Sentences about the seller's own product may name its features (e.g. "preview environments on Kubernetes").
    if (productName && s.toLowerCase().includes(productName.toLowerCase())) continue;
    for (const m of detectInText(s)) {
      if (!known.has(m.def.name.toLowerCase())) out.add(m.def.name);
    }
  }
  return [...out];
}

export function validateAiReport(raw: unknown, facts: EvidenceFact[], stack: StackItem[], productName?: string): { ok: true; report: AiReport } | { ok: false; errors: string[] } {
  const parsed = aiReportSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "root"}: ${i.message}`) };
  }
  const r = parsed.data;
  const errors: string[] = [];
  const ids = new Set(facts.map((f) => f.id));
  const bad = (list: string[]) => list.filter((x) => !ids.has(x));

  for (const [k, p] of [["summary_paragraph_1", r.summary_paragraph_1], ["summary_paragraph_2", r.summary_paragraph_2]] as const) {
    if (/\n/.test(p.trim())) errors.push(`${k} must be a single paragraph without line breaks.`);
    if (/(^|\s)[-*•]\s|#{1,6}\s|\*\*/.test(p)) errors.push(`${k} must be plain prose (no markdown or bullets).`);
    const unsupported = unsupportedTechMentions(p, stack, productName);
    if (unsupported.length) errors.push(`${k} mentions ${unsupported.join(", ")}, which is not in the evidence. Remove it or state it was not found.`);
  }
  const badSummary = bad(r.summary_cited_ids);
  if (badSummary.length) errors.push(`summary_cited_ids contains unknown IDs: ${badSummary.join(", ")}.`);
  for (const it of r.interpretations) {
    const b = bad(it.supporting_ids);
    if (b.length) errors.push(`interpretation "${it.statement.slice(0, 40)}…" cites unknown IDs: ${b.join(", ")}.`);
    if (it.type === "observation" && it.supporting_ids.length === 0) errors.push(`Observation "${it.statement.slice(0, 40)}…" needs supporting_ids.`);
  }

  const o = r.outreach;
  if (o.status === "ready") {
    const line = o.line.trim();
    if (line.length < 40) errors.push("outreach.line is too short or empty.");
    if (line.split(/\s+/).length > 55) errors.push("outreach.line must be one concise sentence (≤ 45 words).");
    if (PLACEHOLDER.test(line)) errors.push("outreach.line contains a placeholder or brackets.");
    if (GENERIC.test(line)) errors.push("outreach.line uses a generic phrase or compliment; reference the specific finding instead.");
    if (PROBLEM_CLAIM.test(line)) errors.push("outreach.line claims the company has a problem; the evidence does not show that.");
    const b = bad(o.referenced_ids);
    if (!o.referenced_ids.length) errors.push("outreach.referenced_ids must cite at least one fact.");
    if (b.length) errors.push(`outreach.referenced_ids contains unknown IDs: ${b.join(", ")}.`);
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

export function toOutreach(r: AiReport, needsVerification: boolean): OutreachResult {
  return {
    status: r.outreach.status,
    line: r.outreach.status === "ready" ? r.outreach.line.trim() : "",
    relevance: r.outreach.relevance.trim(),
    referencedIds: r.outreach.referenced_ids,
    insufficientReason: r.outreach.insufficient_reason.trim(),
    suggestedResearch: r.outreach.suggested_research,
    needsVerification,
  };
}

export function toInterpretations(r: AiReport): Interpretation[] {
  return r.interpretations.map((i) => ({ statement: i.statement, type: i.type, supportingIds: i.supporting_ids }));
}

/** Deterministic report used when there is no evidence at all — no AI call, nothing invented. */
export function insufficientEvidenceReport(input: ReportInput): { paragraphs: [string, string]; outreach: OutreachResult } {
  const found = input.sourceStatuses.filter((s) => s.status === "ok").map((s) => s.source);
  const p1 = `Insufficient public evidence. No programming languages, frameworks, cloud platforms or infrastructure tools could be traced to public sources for ${input.company.name}. ${input.identification.note} ${found.length ? `Sources reached (${found.join(", ")}) did not contain identifiable technology references.` : "None of the configured public sources returned usable data."}`;
  const p2 = `Recent engineering activity: not publicly found. Without verified evidence this report makes no claims about how ${input.company.name} builds software, and no hypothesis about its relevance to ${input.product.name} can be supported yet. Adding the company's GitHub organization, website, engineering blog or careers page URL on the watchlist and refreshing is the quickest way to improve coverage.`;
  return {
    paragraphs: [p1, p2],
    outreach: {
      status: "insufficient_evidence",
      line: "",
      relevance: "",
      referencedIds: [],
      insufficientReason: "No verified technology or engineering-activity evidence was found, so any personalised opening would be invented.",
      suggestedResearch: [
        "Confirm the company's GitHub organization (or confirm it has none).",
        "Add the company website and engineering blog URL.",
        "Add the careers page URL (Greenhouse, Lever or Ashby boards can be read automatically).",
      ],
      needsVerification: false,
    },
  };
}
