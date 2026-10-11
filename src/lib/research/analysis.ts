import {
  CATEGORY_ORDER,
  EVIDENCE_KIND_LABELS,
  type ActivityLevel,
  type ActivityMetrics,
  type Category,
  type ChangeItem,
  type ConfidenceBreakdown,
  type EvidenceItem,
  type EvidenceKind,
  type GithubMethod,
  type LanguageShare,
  type SourceType,
  type StackItem,
} from "@/lib/types";

const DAY = 86_400_000;
export const KIND_RANK: Record<EvidenceKind, number> = { code: 3, repo_language: 3, job_posting: 2, article: 1 };

export const techKey = (category: Category, technology: string) => `${category}:${technology.toLowerCase()}`;

// ------------------------------------------------------------------ stack aggregation

/**
 * Group raw evidence into one entry per technology. IDs (F1, F2, …) are what the AI cites.
 * `firstObserved` carries first-observed dates from earlier research runs.
 */
export function buildStack(
  evidence: EvidenceItem[],
  languages: LanguageShare[],
  firstObserved: Map<string, string>,
  nowIso: string,
): StackItem[] {
  const groups = new Map<string, EvidenceItem[]>();
  for (const e of evidence) {
    const k = techKey(e.category, e.technology);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const shareOf = new Map(languages.map((l) => [l.name.toLowerCase(), l.share]));

  const items = [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || Date.parse(b.source.publishedAt ?? "0") - Date.parse(a.source.publishedAt ?? "0"));
    const seen = new Set<string>();
    const unique = sorted.filter((e) => {
      const id = `${e.source.url}|${e.evidence}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    const dates = list.map((e) => e.source.publishedAt).filter((d): d is string => Boolean(d)).sort();
    const first = list[0];
    return {
      id: "",
      technology: first.technology,
      category: first.category,
      strongestKind: sorted[0].kind,
      evidenceCount: unique.length,
      sourceTypes: [...new Set(list.map((e) => e.source.type))] as SourceType[],
      firstObservedAt: firstObserved.get(key) ?? nowIso,
      lastObservedAt: dates.at(-1) ?? null,
      share: first.category === "language" ? shareOf.get(first.technology.toLowerCase()) : undefined,
      evidence: unique.slice(0, 5).map((e) => ({ kind: e.kind, text: e.evidence, url: e.source.url, title: e.source.title, date: e.source.publishedAt })),
    } satisfies StackItem;
  });

  items.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (b.share ?? -1) - (a.share ?? -1) ||
      KIND_RANK[b.strongestKind] - KIND_RANK[a.strongestKind] ||
      b.evidenceCount - a.evidenceCount ||
      a.technology.localeCompare(b.technology),
  );
  items.forEach((it, i) => (it.id = `F${i + 1}`));
  return items;
}

// ------------------------------------------------------------------ confidence (defined scoring method)

export const CONFIDENCE_METHOD = [
  "GitHub identification (25): provided or confirmed by website match 25 · name match only 8 · none 0",
  "Code coverage (25): ≥8 repositories analyzed 25 · 4–7 18 · 1–3 10 · none 0",
  "Source diversity (25): independent source types with findings (GitHub code, job postings, articles) — 3 → 25 · 2 → 18 · 1 → 10 · 0 → 0",
  "Recency (25): newest evidence ≤30 days 25 · ≤90 days 18 · ≤1 year 10 · older 4 · none 0",
  "Level: High ≥ 75 · Medium 45–74 · Low < 45. An unconfirmed GitHub match caps the level at Medium; no findings caps it at Low.",
];

export function scoreConfidence(input: {
  githubMethod: GithubMethod;
  reposAnalyzed: number;
  evidence: EvidenceItem[];
  now?: number;
}): ConfidenceBreakdown {
  const now = input.now ?? Date.now();
  const comps: ConfidenceBreakdown["components"] = [];

  const idPts = input.githubMethod === "user_provided" || input.githubMethod === "verified_domain" ? 25 : input.githubMethod === "name_match_unconfirmed" ? 8 : 0;
  comps.push({
    name: "GitHub identification",
    points: idPts,
    max: 25,
    reason:
      input.githubMethod === "user_provided"
        ? "Organization provided on the watchlist"
        : input.githubMethod === "verified_domain"
          ? "Organization's profile links to the company website"
          : input.githubMethod === "name_match_unconfirmed"
            ? "Matched by name only — unconfirmed"
            : "No GitHub organization identified",
  });

  const r = input.reposAnalyzed;
  const covPts = r >= 8 ? 25 : r >= 4 ? 18 : r >= 1 ? 10 : 0;
  comps.push({ name: "Code coverage", points: covPts, max: 25, reason: `${r} public repositories analyzed` });

  const families = new Set<string>();
  for (const e of input.evidence) {
    if (e.kind === "code" || e.kind === "repo_language") families.add("GitHub code");
    else if (e.kind === "job_posting") families.add("Job postings");
    else families.add("Articles");
  }
  const divPts = families.size >= 3 ? 25 : families.size === 2 ? 18 : families.size === 1 ? 10 : 0;
  comps.push({ name: "Source diversity", points: divPts, max: 25, reason: families.size ? [...families].join(", ") : "No source produced findings" });

  const newest = input.evidence.map((e) => (e.source.publishedAt ? Date.parse(e.source.publishedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
  const age = newest ? (now - newest) / DAY : Infinity;
  const recPts = !newest ? 0 : age <= 30 ? 25 : age <= 90 ? 18 : age <= 365 ? 10 : 4;
  comps.push({ name: "Recency", points: recPts, max: 25, reason: newest ? `Newest evidence dated ${new Date(newest).toISOString().slice(0, 10)}` : "No dated evidence" });

  const score = comps.reduce((s, c) => s + c.points, 0);
  let level: ConfidenceBreakdown["level"] = score >= 75 ? "High" : score >= 45 ? "Medium" : "Low";
  let cappedReason: string | null = null;
  if (input.evidence.length === 0) {
    level = "Low";
    cappedReason = "No technology findings were collected.";
  } else if (input.githubMethod === "name_match_unconfirmed" && level === "High") {
    level = "Medium";
    cappedReason = "GitHub organization is an unconfirmed name match.";
  }
  return { score, level, components: comps, cappedReason };
}

// ------------------------------------------------------------------ snapshots + change tracking

export interface Snapshot {
  githubLogin: string | null;
  technologies: { key: string; technology: string; category: Category; kinds: EvidenceKind[]; sourceUrl: string | null; lastObservedAt: string | null }[];
  languages: { name: string; share: number }[];
  releases: { url: string; repo: string; tag: string; publishedAt: string }[];
  jobs: { url: string; title: string; publishedAt: string | null; technologies: string[] }[];
  newRepos: { name: string; url: string; createdAt: string }[];
  activityLevel: ActivityLevel;
}

export function buildSnapshot(stack: StackItem[], languages: LanguageShare[], activity: ActivityMetrics, evidence: EvidenceItem[], githubLogin: string | null): Snapshot {
  const jobs = new Map<string, Snapshot["jobs"][number]>();
  for (const e of evidence) {
    if (e.kind !== "job_posting") continue;
    const j = jobs.get(e.source.url) ?? { url: e.source.url, title: e.source.title, publishedAt: e.source.publishedAt, technologies: [] };
    if (!j.technologies.includes(e.technology)) j.technologies.push(e.technology);
    jobs.set(e.source.url, j);
  }
  return {
    githubLogin,
    technologies: stack.map((s) => ({
      key: techKey(s.category, s.technology),
      technology: s.technology,
      category: s.category,
      kinds: [...new Set(s.evidence.map((e) => e.kind))],
      sourceUrl: s.evidence[0]?.url ?? null,
      lastObservedAt: s.lastObservedAt,
    })),
    languages: languages.filter((l) => l.share >= 0.01).map((l) => ({ name: l.name, share: Number(l.share.toFixed(4)) })),
    releases: activity.releases180d.map((r) => ({ url: r.url, repo: r.repo, tag: r.tag, publishedAt: r.publishedAt })),
    jobs: [...jobs.values()],
    newRepos: activity.newRepos90d,
    activityLevel: activity.level,
  };
}

/**
 * Compare two saved snapshots. "Newly observed" means it appeared in public evidence for
 * the first time — never that the company adopted it. Missing observations are reported as
 * "not re-observed", never as "stopped using".
 */
export function diffSnapshots(prev: Snapshot | null, cur: Snapshot, snapshotAt: string): ChangeItem[] {
  if (!prev) return [];
  const out: ChangeItem[] = [];

  if (prev.githubLogin !== cur.githubLogin) {
    out.push({
      kind: "github_org_changed",
      title: `GitHub organization changed: ${prev.githubLogin ?? "none"} → ${cur.githubLogin ?? "none"}`,
      description: "Code-based findings below are not directly comparable with the previous snapshot.",
      date: snapshotAt,
      sourceUrl: cur.githubLogin ? `https://github.com/${cur.githubLogin}` : null,
    });
  }

  const prevTech = new Map(prev.technologies.map((t) => [t.key, t]));
  const curTech = new Map(cur.technologies.map((t) => [t.key, t]));
  for (const t of cur.technologies) {
    if (prevTech.has(t.key)) continue;
    const via = t.kinds.map((k) => EVIDENCE_KIND_LABELS[k].toLowerCase()).join(", ");
    out.push({
      kind: t.category === "language" ? "new_language" : "new_technology",
      title: `Newly observed: ${t.technology}`,
      description: `First seen in public evidence (${via}). This is when it became visible to us, not necessarily when the company adopted it.`,
      date: t.lastObservedAt ?? snapshotAt,
      sourceUrl: t.sourceUrl,
      category: t.category,
    });
  }

  const prevJobs = new Set(prev.jobs.map((j) => j.url));
  for (const j of cur.jobs.filter((j) => !prevJobs.has(j.url)).slice(0, 6)) {
    out.push({
      kind: "new_job_posting",
      title: `New technical job posting: ${j.title}`,
      description: `Mentions ${j.technologies.join(", ")}.`,
      date: j.publishedAt ?? snapshotAt,
      sourceUrl: j.url,
    });
  }

  const prevRel = new Set(prev.releases.map((r) => r.url));
  for (const r of cur.releases.filter((r) => !prevRel.has(r.url)).slice(0, 5)) {
    out.push({ kind: "new_release", title: `New release: ${r.repo} ${r.tag}`, description: "Published on GitHub since the previous snapshot.", date: r.publishedAt, sourceUrl: r.url });
  }

  const prevRepos = new Set(prev.newRepos.map((r) => r.url));
  for (const r of cur.newRepos.filter((r) => !prevRepos.has(r.url)).slice(0, 5)) {
    out.push({ kind: "new_repository", title: `New public repository: ${r.name}`, description: "Created recently and visible for the first time.", date: r.createdAt, sourceUrl: r.url });
  }

  const prevShare = new Map(prev.languages.map((l) => [l.name, l.share]));
  for (const l of cur.languages) {
    const before = prevShare.get(l.name);
    if (before !== undefined && Math.abs(l.share - before) >= 0.1) {
      out.push({
        kind: "language_shift",
        title: `${l.name} share ${l.share > before ? "rose" : "fell"}: ${(before * 100).toFixed(0)}% → ${(l.share * 100).toFixed(0)}%`,
        description: "Share of code bytes across the analyzed public repositories. Sample changes can move this number too.",
        date: snapshotAt,
        sourceUrl: null,
        category: "language",
      });
    }
  }

  if (prev.activityLevel !== cur.activityLevel) {
    out.push({ kind: "activity_change", title: `Public activity: ${prev.activityLevel} → ${cur.activityLevel}`, description: "Based on repository pushes and sampled commits.", date: snapshotAt, sourceUrl: null });
  }

  for (const t of prev.technologies) {
    if (curTech.has(t.key)) continue;
    out.push({
      kind: "not_reobserved",
      title: `Not re-observed: ${t.technology}`,
      description:
        "Not found in this refresh's evidence. This does not mean the company stopped using it — a posting may have closed or a repository may have left the sample.",
      date: snapshotAt,
      sourceUrl: t.sourceUrl,
      category: t.category,
    });
  }
  return out;
}
