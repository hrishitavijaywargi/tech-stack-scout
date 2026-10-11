import { describe, expect, it } from "vitest";
import { activityScore, fitScore, logScale, techConfidence } from "@/lib/scoring";
import { buildStack, diffSnapshots, scoreConfidence, type DiffInput } from "@/lib/research/analysis";
import { emptyActivity } from "@/lib/collectors/github";
import { emptyHiring } from "@/lib/collectors/jobs";
import type { EvidenceItem } from "@/lib/types";

const NOW = Date.parse("2026-10-11T00:00:00Z");
const ev = (technology: string, category: EvidenceItem["category"], kind: EvidenceItem["kind"], url = `https://x/${technology}/${kind}`, date = "2026-10-01T00:00:00Z"): EvidenceItem => ({
  technology,
  category,
  kind,
  source: { url, type: kind === "job_posting" ? "job_posting" : "github_repo", title: url, publishedAt: date },
  evidence: `${technology} via ${kind}`,
});

describe("activity score", () => {
  it("is 0 for a dormant org and 80–100 for a very active one", () => {
    expect(activityScore(emptyActivity(), { eng_open_roles: 0 }).score).toBe(0);
    const busy = { ...emptyActivity(), commits_90d: 1500, repos_active_30d: 25, repos_active_90d: 50, contributors: 100, releases_90d: 20 };
    const s = activityScore(busy, { eng_open_roles: 50 });
    expect(s.score).toBe(100);
    const mid = activityScore({ ...emptyActivity(), commits_90d: 120, repos_active_30d: 4, repos_active_90d: 8, contributors: 15, releases_90d: 2 }, { eng_open_roles: 5 }).score;
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(80);
  });

  it("log-scales", () => {
    expect(logScale(0, 10)).toBe(0);
    expect(logScale(10, 10)).toBe(1);
    expect(logScale(1000, 10)).toBe(1);
  });
});

describe("per-technology confidence", () => {
  it("high = 2+ independent sources, medium = code or 3+ postings, low = weak signal", () => {
    expect(techConfidence(["code", "job_posting"], 1).confidence).toBe("high");
    expect(techConfidence(["code", "repo_language"], 0).confidence).toBe("medium"); // same family
    expect(techConfidence(["job_posting"], 5).confidence).toBe("medium");
    expect(techConfidence(["job_posting"], 1).confidence).toBe("low");
    expect(techConfidence(["dns"], 0).confidence).toBe("low");
  });
});

describe("fit score", () => {
  const profile = { target_languages: ["Go", "TypeScript"], target_clouds: ["AWS"], target_signals: ["Kubernetes", "Microservices", "Terraform"] };
  it("rewards target languages, clouds and signals with an explainable breakdown", () => {
    const stack = buildStack([ev("AWS", "cloud", "code"), ev("AWS", "cloud", "job_posting"), ev("Kubernetes", "containers", "code"), ev("Terraform", "iac", "job_posting")], [], new Map(), "2026-10-11T00:00:00Z", {
      tech_mentions: [{ tech: "Terraform", count: 4, category: "iac" }],
    });
    const recent = [
      { name: "Go", bytes: 60, pct: 60, repos: 3, color: null },
      { name: "Python", bytes: 40, pct: 40, repos: 2, color: null },
    ];
    const r = fitScore(profile, stack, recent, recent, emptyHiring());
    expect(r.components.map((c) => c.points)).toEqual([40, 30, 16]); // Go ≥50% · AWS high · K8s medium + Terraform medium
    expect(r.score).toBe(86);
  });

  it("is low when nothing overlaps", () => {
    expect(fitScore(profile, [], [], [], emptyHiring()).score).toBe(0);
  });
});

describe("stack + overall confidence", () => {
  it("groups evidence, orders by category, assigns IDs and confidence", () => {
    const stack = buildStack([ev("Docker", "containers", "job_posting"), ev("Docker", "containers", "code"), ev("Go", "language", "repo_language"), ev("AWS", "cloud", "dns")], [{ name: "Go", bytes: 1, pct: 80, repos: 1, color: null }], new Map(), "2026-10-11T00:00:00Z");
    expect(stack.map((s) => [s.id, s.tech, s.confidence])).toEqual([
      ["F1", "Go", "medium"],
      ["F2", "AWS", "low"],
      ["F3", "Docker", "high"],
    ]);
    expect(stack[0].pct).toBe(80);
  });

  it("caps unconfirmed GitHub matches and empty evidence", () => {
    const evidence = [ev("Go", "language", "repo_language", "a", "2026-10-05T00:00:00Z"), ev("Kafka", "data", "job_posting"), ev("AWS", "cloud", "dns")];
    expect(scoreConfidence({ githubMethod: "verified_domain", reposAnalyzed: 10, evidence, now: NOW }).level).toBe("High");
    expect(scoreConfidence({ githubMethod: "name_match_unconfirmed", reposAnalyzed: 10, evidence, now: NOW }).level).toBe("Medium");
    expect(scoreConfidence({ githubMethod: "none", reposAnalyzed: 0, evidence: [], now: NOW }).level).toBe("Low");
  });
});

describe("change tracking", () => {
  const base = (over: Partial<DiffInput>): DiffInput => ({ githubLogin: "acme", stack: [], languages: [], activity: emptyActivity("Active"), hiring: emptyHiring(), ...over });

  it("returns nothing for the first snapshot", () => {
    expect(diffSnapshots(null, base({}), "2026-10-11T00:00:00Z")).toEqual([]);
  });

  it("reports newly observed vs not re-observed (never 'stopped using'), hiring and releases", () => {
    const tech = (name: string, category: EvidenceItem["category"]) => ({ tech: name, category, kinds: ["code" as const], lastObservedAt: null, evidence: [] });
    const prev = base({ stack: [tech("AWS", "cloud")], hiring: { ...emptyHiring(), eng_open_roles: 20, tech_mentions: [{ tech: "Go", count: 3, category: "language" }] } });
    const cur = base({
      stack: [tech("Terraform", "iac")],
      activity: { ...emptyActivity("Very active"), releases: [{ url: "r1", repo: "acme/api", tag: "v2", name: "v2", publishedAt: "2026-10-02T00:00:00Z" }] },
      hiring: { ...emptyHiring(), eng_open_roles: 32, tech_mentions: [{ tech: "Go", count: 4, category: "language" }, { tech: "Rust", count: 2, category: "language" }] },
    });
    const changes = diffSnapshots(prev, cur, "2026-10-11T00:00:00Z");
    expect(changes.map((c) => c.kind)).toEqual(expect.arrayContaining(["new_technology", "not_reobserved", "new_job_posting", "hiring_change", "new_release", "activity_change"]));
    expect(changes.find((c) => c.kind === "not_reobserved")!.description).toMatch(/does not mean the company stopped/);
    expect(changes.find((c) => c.kind === "new_technology")!.description).toMatch(/not necessarily when the company adopted/);
    expect(changes.find((c) => c.kind === "new_job_posting")!.title).toMatch(/Rust/);
  });
});
