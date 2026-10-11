import { describe, expect, it } from "vitest";
import { buildSnapshot, buildStack, diffSnapshots, scoreConfidence, type Snapshot } from "@/lib/research/analysis";
import { emptyActivity } from "@/lib/sources/github";
import type { EvidenceItem } from "@/lib/types";

const NOW = Date.parse("2026-10-11T00:00:00Z");
const ev = (technology: string, category: EvidenceItem["category"], kind: EvidenceItem["kind"], url: string, date = "2026-10-01T00:00:00Z"): EvidenceItem => ({
  technology,
  category,
  kind,
  source: { url, type: kind === "job_posting" ? "job_posting" : "github_repo", title: url, publishedAt: date },
  evidence: `${technology} at ${url}`,
});

describe("buildStack", () => {
  it("groups evidence per technology, orders by category and assigns IDs", () => {
    const stack = buildStack(
      [
        ev("Docker", "infrastructure", "job_posting", "https://jobs/1"),
        ev("Docker", "infrastructure", "code", "https://github.com/a/b"),
        ev("Go", "language", "repo_language", "https://github.com/a/b"),
        ev("AWS", "cloud", "code", "https://github.com/a/c"),
      ],
      [{ name: "Go", bytes: 100, share: 0.8, repos: 2, topRepo: null }],
      new Map([["infrastructure:docker", "2026-01-01T00:00:00Z"]]),
      "2026-10-11T00:00:00Z",
    );
    expect(stack.map((s) => [s.id, s.technology])).toEqual([
      ["F1", "Go"],
      ["F2", "AWS"],
      ["F3", "Docker"],
    ]);
    const docker = stack[2];
    expect(docker.strongestKind).toBe("code");
    expect(docker.evidenceCount).toBe(2);
    expect(docker.firstObservedAt).toBe("2026-01-01T00:00:00Z");
    expect(stack[0].share).toBe(0.8);
  });
});

describe("scoreConfidence", () => {
  it("scores well-covered, recent, multi-source evidence as High", () => {
    const c = scoreConfidence({
      githubMethod: "verified_domain",
      reposAnalyzed: 10,
      evidence: [ev("Go", "language", "repo_language", "u1", "2026-10-05T00:00:00Z"), ev("Kafka", "architecture", "job_posting", "u2"), { ...ev("AWS", "cloud", "article", "u3"), kind: "article" }],
      now: NOW,
    });
    expect(c.score).toBe(100);
    expect(c.level).toBe("High");
  });

  it("caps unconfirmed GitHub matches at Medium and empty evidence at Low", () => {
    const c = scoreConfidence({
      githubMethod: "name_match_unconfirmed",
      reposAnalyzed: 10,
      evidence: [ev("Go", "language", "repo_language", "u1"), ev("Kafka", "architecture", "job_posting", "u2"), { ...ev("AWS", "cloud", "article", "u3"), kind: "article" }],
      now: NOW,
    });
    expect(c.level).toBe("Medium");
    expect(c.cappedReason).toMatch(/unconfirmed/);
    expect(scoreConfidence({ githubMethod: "none", reposAnalyzed: 0, evidence: [], now: NOW }).level).toBe("Low");
  });
});

describe("diffSnapshots", () => {
  const base = (over: Partial<Snapshot>): Snapshot => ({
    githubLogin: "acme",
    technologies: [],
    languages: [],
    releases: [],
    jobs: [],
    newRepos: [],
    activityLevel: "Active",
    ...over,
  });

  it("returns nothing for the first snapshot", () => {
    expect(diffSnapshots(null, base({}), "2026-10-11T00:00:00Z")).toEqual([]);
  });

  it("reports newly observed vs not re-observed, never 'stopped using'", () => {
    const prev = base({ technologies: [{ key: "cloud:aws", technology: "AWS", category: "cloud", kinds: ["code"], sourceUrl: "u", lastObservedAt: null }] });
    const cur = base({
      technologies: [{ key: "infrastructure:terraform", technology: "Terraform", category: "infrastructure", kinds: ["code"], sourceUrl: "t", lastObservedAt: "2026-10-01T00:00:00Z" }],
      releases: [{ url: "r1", repo: "acme/api", tag: "v2.0.0", publishedAt: "2026-10-02T00:00:00Z" }],
      jobs: [{ url: "j1", title: "Platform Engineer", publishedAt: null, technologies: ["Kubernetes"] }],
      activityLevel: "Very active",
    });
    const changes = diffSnapshots(prev, cur, "2026-10-11T00:00:00Z");
    const kinds = changes.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(["new_technology", "new_release", "new_job_posting", "activity_change", "not_reobserved"]));
    const gone = changes.find((c) => c.kind === "not_reobserved")!;
    expect(gone.description).toMatch(/does not mean the company stopped/);
    expect(changes.find((c) => c.kind === "new_technology")!.description).toMatch(/not necessarily when the company adopted/);
  });

  it("builds a snapshot that round-trips through diff without changes", () => {
    const stack = buildStack([ev("Go", "language", "repo_language", "u")], [], new Map(), "2026-10-11T00:00:00Z");
    const snap = buildSnapshot(stack, [], emptyActivity(), [], "acme");
    expect(diffSnapshots(snap, snap, "2026-10-11T00:00:00Z")).toEqual([]);
  });
});
