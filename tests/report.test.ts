import { describe, expect, it } from "vitest";
import { buildFacts, buildPrompt, insufficientEvidenceReport, stripCitations, validateAiReport, type ReportInput } from "@/lib/ai/report";
import { buildStack } from "@/lib/research/analysis";
import { emptyActivity } from "@/lib/sources/github";
import type { EvidenceItem } from "@/lib/types";

const ev = (technology: string, category: EvidenceItem["category"]): EvidenceItem => ({
  technology,
  category,
  kind: "code",
  source: { url: `https://github.com/acme/${technology}`, type: "github_repo", title: "acme/x", publishedAt: "2026-10-01T00:00:00Z" },
  evidence: `${technology} found`,
});

const stack = buildStack([ev("Go", "language"), ev("Kubernetes", "infrastructure"), ev("Terraform", "infrastructure")], [], new Map(), "2026-10-11T00:00:00Z");
const input: ReportInput = {
  company: { name: "Acme", domain: "acme.com" },
  product: { name: "FlowPilot", description: "CI acceleration and preview environments on Kubernetes and AWS." },
  identification: { login: "acme", method: "verified_domain", profileUrl: null, displayName: null, blog: null, candidates: [], note: "verified" },
  stack,
  activity: emptyActivity(),
  jobPostings: [{ title: "Senior Platform Engineer", url: "https://jobs/1", publishedAt: null }],
  articles: [],
  sourceStatuses: [],
  limitations: [],
};
const facts = buildFacts(input);
const P = "x".repeat(10);
const para = (s: string) => `${s} ${"Observed in public repositories with specific evidence for this company only. ".repeat(3)}`;

const good = {
  summary_paragraph_1: para("Acme's public code is mostly Go, deployed with Kubernetes and provisioned with Terraform."),
  summary_paragraph_2: para("Hypothesis: FlowPilot's preview environments on AWS may fit their Kubernetes workflow."),
  summary_cited_ids: ["F1", "F2"],
  outreach: {
    status: "ready",
    line: "Saw your Terraform modules alongside the Kubernetes manifests in your public repos — curious how long a fresh preview environment takes your platform team today?",
    referenced_ids: ["F2", "F3"],
    relevance: "Infra-as-code + Kubernetes is where preview environments save time.",
    insufficient_reason: "",
    suggested_research: [],
  },
  interpretations: [{ statement: "Go is the main public language", type: "observation", supporting_ids: ["F1"] }],
  limitations: ["Public code only"],
};

describe("validateAiReport", () => {
  it("builds facts with IDs for technologies and jobs", () => {
    expect(facts.map((f) => f.id)).toEqual(["F1", "F2", "F3", "J1"]);
    expect(buildPrompt(input, facts)).toContain("F2 | technology");
  });

  it("accepts an evidence-grounded report (product sentences may name product features)", () => {
    const r = validateAiReport(good, facts, stack, "FlowPilot");
    expect(r.ok).toBe(true);
  });

  it("rejects unknown citations and technologies not in evidence", () => {
    const bad = { ...good, summary_cited_ids: ["F9"], summary_paragraph_1: para("Acme runs everything on Microsoft Azure with Kafka.") };
    const r = validateAiReport(bad, facts, stack, "FlowPilot");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(" ")).toMatch(/unknown IDs: F9/);
      expect(r.errors.join(" ")).toMatch(/Microsoft Azure/);
    }
  });

  it("allows negated mentions ('no evidence of AWS')", () => {
    const r = validateAiReport({ ...good, summary_paragraph_1: para("No public evidence of AWS was found; the code is Go on Kubernetes.") }, facts, stack, "FlowPilot");
    expect(r.ok).toBe(true);
  });

  it("rejects placeholders, generic compliments, problem claims and unanchored lines", () => {
    const line = (l: string) => validateAiReport({ ...good, outreach: { ...good.outreach, line: l } }, facts, stack, "FlowPilot");
    expect(line("Hi [FirstName], I noticed your Terraform setup and wanted to connect about productivity.").ok).toBe(false);
    expect(line("Your Terraform work is really impressive and I would love to show you our developer platform.").ok).toBe(false);
    expect(line("Your team must be struggling with slow Terraform plans across all those Kubernetes clusters, right?").ok).toBe(false);
    expect(line("I'd love to show you how our developer productivity platform helps engineering teams ship faster.").ok).toBe(false);
  });

  it("requires a reason and next steps when evidence is insufficient", () => {
    const r = validateAiReport({ ...good, outreach: { ...good.outreach, status: "insufficient_evidence", line: "", referenced_ids: [], insufficient_reason: "", suggested_research: [] } }, facts, stack);
    expect(r.ok).toBe(false);
  });

  it("validates the JSON shape", () => {
    expect(validateAiReport({ summary_paragraph_1: P }, facts, stack).ok).toBe(false);
  });
});

describe("stripCitations", () => {
  it("removes leaked fact IDs from prose but keeps real parentheses", () => {
    expect(stripCitations("Go is dominant (F1, F2, F7). Releases include raft v1.8.0 [R3].")).toBe("Go is dominant. Releases include raft v1.8.0.");
    expect(stripCitations("Kubernetes (via Helm charts) is used.")).toBe("Kubernetes (via Helm charts) is used.");
  });
});

describe("insufficientEvidenceReport", () => {
  it("makes no claims and gives next steps", () => {
    const r = insufficientEvidenceReport({ ...input, stack: [] });
    expect(r.paragraphs).toHaveLength(2);
    expect(r.paragraphs[0]).toMatch(/Insufficient public evidence/);
    expect(r.outreach.status).toBe("insufficient_evidence");
    expect(r.outreach.suggestedResearch.length).toBeGreaterThan(0);
  });
});
