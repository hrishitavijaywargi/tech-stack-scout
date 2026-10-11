import { describe, expect, it } from "vitest";
import { buildFacts, buildPrompt, insufficientEvidenceInsight, stripCitations, toInsight, unsupportedTechMentions, validateAiReport, type ReportInput } from "@/lib/ai/report";
import { buildStack } from "@/lib/research/analysis";
import { emptyActivity } from "@/lib/collectors/github";
import { emptyHiring } from "@/lib/collectors/jobs";
import { emptyResearch } from "@/lib/collectors/webResearch";
import type { EvidenceItem } from "@/lib/types";

const ev = (technology: string, category: EvidenceItem["category"]): EvidenceItem => ({
  technology,
  category,
  kind: "code",
  source: { url: `https://github.com/acme/${technology}`, type: "github_repo", title: "acme/x", publishedAt: "2026-10-01T00:00:00Z" },
  evidence: `${technology} found`,
});

const stack = buildStack([ev("Go", "language"), ev("Kubernetes", "containers"), ev("Terraform", "iac")], [], new Map(), "2026-10-11T00:00:00Z");
const input: ReportInput = {
  company: { name: "Acme", domain: "acme.com" },
  product: { product_name: "FlowPilot", one_liner: "Faster CI", description: "CI acceleration and preview environments on Kubernetes and AWS.", target_languages: ["Go"], target_clouds: ["AWS"], target_signals: ["Kubernetes"] },
  identification: { login: "acme", method: "verified_domain", profileUrl: null, displayName: null, blog: null, candidates: [], note: "verified" },
  stack,
  recentLanguages: [],
  activity: emptyActivity(),
  hiring: { ...emptyHiring(), provider: "greenhouse", slug: "acme", eng_open_roles: 12, total_open_roles: 30, sample_roles: [{ title: "Senior Platform Engineer", url: "https://jobs/1", team: null, techs: ["Kubernetes"] }] },
  dns: { hosting: [{ provider: "AWS", host: "acme.com", record: "NS awsdns" }], email_provider: "Google Workspace", saas_verifications: [], spf_includes: [], nameservers: [] },
  subdomains: { count: 3, tooling: [{ subdomain: "grafana.acme.com", tool: "Grafana", tech: "Grafana" }] },
  blogPosts: [],
  hnStories: [],
  webResearch: emptyResearch(),
  scores: { activity: 55, fit: 70, breakdown: { activity: [], fit: [] } },
  trend: { previousActivityScore: 50, previousEngRoles: 9, previousCapturedAt: null },
  sourceSummary: [],
  limitations: [],
};
const facts = buildFacts(input);
const para = (s: string) => `${s} ${"Observed in public repositories with specific evidence for this company only. ".repeat(3)}`;

const good = {
  summary_paragraph_1: para("Acme's public code is mostly Go, deployed with Kubernetes and provisioned with Terraform."),
  summary_paragraph_2: para("Hypothesis: FlowPilot's preview environments on AWS may fit their Kubernetes workflow."),
  summary_cited_ids: ["F1", "F2"],
  talking_points: [
    { point: "Terraform and Kubernetes manifests live side by side in public repos", evidence_ids: ["F2", "F3"] },
    { point: "Twelve open engineering roles, up from nine", evidence_ids: ["H1"] },
    { point: "Platform role asks for Kubernetes", evidence_ids: ["J1"] },
  ],
  outreach: {
    status: "ready",
    line: "Saw the Terraform modules next to your Kubernetes manifests — how long does a fresh preview environment take your platform team today?",
    rationale: "Uses the Terraform and Kubernetes code findings.",
    referenced_ids: ["F2", "F3"],
    insufficient_reason: "",
    suggested_research: [],
  },
  interpretations: [{ statement: "Go is the main public language", type: "observation", supporting_ids: ["F1"] }],
  limitations: ["Public code only"],
};

describe("evidence pack", () => {
  it("includes technologies, hiring (with trend), roles, DNS and subdomain facts", () => {
    expect(facts.map((f) => f.id)).toEqual(["F1", "F2", "F3", "H1", "J1", "D1", "D2", "S1"]);
    expect(facts.find((f) => f.id === "H1")!.text).toMatch(/previous snapshot: 9/);
    expect(buildPrompt(input, facts)).toContain("F2 | technology");
  });
});

describe("validateAiReport", () => {
  it("accepts an evidence-grounded report (product sentences may name product features)", () => {
    expect(validateAiReport(good, facts, stack, "FlowPilot").ok).toBe(true);
  });

  it("rejects unknown citations, unsupported technologies and talking points without evidence", () => {
    const r = validateAiReport(
      { ...good, summary_cited_ids: ["F9"], summary_paragraph_1: para("Acme runs everything on Microsoft Azure with Kafka."), talking_points: [{ point: "Something unsupported here", evidence_ids: [] }] },
      facts,
      stack,
      "FlowPilot",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join(" ");
      expect(all).toMatch(/unknown IDs: F9/);
      expect(all).toMatch(/Microsoft Azure/);
      expect(all).toMatch(/talking_points\[0\] needs evidence_ids/);
    }
  });

  it("allows negated mentions and a language named inside a known framework", () => {
    expect(validateAiReport({ ...good, summary_paragraph_1: para("No public evidence of AWS was found; the code is Go on Kubernetes.") }, facts, stack, "FlowPilot").ok).toBe(true);
    const rails = buildStack([ev("Ruby on Rails", "framework")], [], new Map(), "2026-10-11T00:00:00Z");
    expect(unsupportedTechMentions("Their Ruby on Rails apps are large.", rails)).toEqual([]);
  });

  it("rejects placeholders, banned phrases, problem claims, long lines and unanchored lines", () => {
    const line = (l: string) => validateAiReport({ ...good, outreach: { ...good.outreach, line: l } }, facts, stack, "FlowPilot").ok;
    expect(line("Hi [FirstName], I noticed your Terraform setup and wanted to connect about productivity.")).toBe(false);
    expect(line("I hope this finds you well — your Terraform work across Kubernetes looks great to me.")).toBe(false);
    expect(line("Your team must be struggling with slow Terraform plans across all those Kubernetes clusters, right?")).toBe(false);
    expect(line("I'd love to show you how our developer productivity platform helps engineering teams ship faster.")).toBe(false);
    expect(line(`Terraform ${"and more words ".repeat(20)}`)).toBe(false);
  });
});

describe("insight output", () => {
  it("joins exactly two paragraphs and strips leaked citation IDs", () => {
    const i = toInsight({ ...good, summary_paragraph_1: good.summary_paragraph_1 + " Go dominates (F1, F2)." } as never, false);
    expect(i.summary.split("\n\n")).toHaveLength(2);
    expect(i.summary).not.toMatch(/\(F1/);
    expect(i.talkingPoints).toHaveLength(3);
    expect(stripCitations("Kubernetes (via Helm charts) is used [R3].")).toBe("Kubernetes (via Helm charts) is used.");
  });

  it("makes no claims when there is no evidence", () => {
    const r = insufficientEvidenceInsight({ ...input, stack: [] });
    expect(r.summary.split("\n\n")).toHaveLength(2);
    expect(r.outreachLine).toBeNull();
    expect(r.outreach.suggestedResearch.length).toBeGreaterThan(0);
  });
});
