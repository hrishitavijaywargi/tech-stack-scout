import { techConfidence } from "@/lib/scoring";
import {
  CATEGORY_ORDER,
  EVIDENCE_KIND_LABELS,
  type Activity,
  type Category,
  type ChangeItem,
  type ConfidenceBreakdown,
  type EvidenceItem,
  type EvidenceKind,
  type GithubMethod,
  type Hiring,
  type LanguageShare,
  type StackItem,
} from "@/lib/types";

const DAY = 86_400_000;
export const KIND_RANK: Record<EvidenceKind, number> = { code: 5, repo_language: 5, job_posting: 4, dns: 2, subdomain: 2, article: 1, web_research: 1 };
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const;

export const techKey = (category: Category, technology: string) => `${category}:${technology.toLowerCase()}`;

// ------------------------------------------------------------------ stack aggregation

/**
 * Group raw evidence into one entry per technology, with a confidence level from the number of
 * independent sources. IDs (F1, F2, …) are what the AI cites. `firstObserved` carries
 * first-observed dates from earlier research runs.
 */
export function buildStack(evidence: EvidenceItem[], languages: LanguageShare[], firstObserved: Map<string, string>, nowIso: string, hiring?: Pick<Hiring, "tech_mentions">): StackItem[] {
  const groups = new Map<string, EvidenceItem[]>();
  for (const e of evidence) {
    const k = techKey(e.category, e.technology);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const pctOf = new Map(languages.map((l) => [l.name.toLowerCase(), l.pct]));
  const jobCount = new Map((hiring?.tech_mentions ?? []).map((t) => [t.tech.toLowerCase(), t.count]));

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
    const kinds = [...new Set(list.map((e) => e.kind))];
    const first = list[0];
    const postings = jobCount.get(first.technology.toLowerCase()) ?? list.filter((e) => e.kind === "job_posting").length;
    const { confidence, reason } = techConfidence(kinds, postings);
    return {
      id: "",
      tech: first.technology,
      category: first.category,
      confidence,
      confidenceReason: reason,
      strongestKind: sorted[0].kind,
      evidenceCount: unique.length,
      kinds,
      firstObservedAt: firstObserved.get(key) ?? nowIso,
      lastObservedAt: dates.at(-1) ?? null,
      pct: first.category === "language" ? pctOf.get(first.technology.toLowerCase()) : undefined,
      evidence: unique.slice(0, 6).map((e) => ({
        kind: e.kind,
        source: EVIDENCE_KIND_LABELS[e.kind],
        detail: e.evidence,
        url: (e.detail?.url as string | undefined) ?? e.source.url,
        title: e.source.title,
        date: e.source.publishedAt,
      })),
    } satisfies StackItem;
  });

  items.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (b.pct ?? -1) - (a.pct ?? -1) ||
      CONF_RANK[b.confidence] - CONF_RANK[a.confidence] ||
      KIND_RANK[b.strongestKind] - KIND_RANK[a.strongestKind] ||
      b.evidenceCount - a.evidenceCount ||
      a.tech.localeCompare(b.tech),
  );
  items.forEach((it, i) => (it.id = `F${i + 1}`));
  return items;
}

// ------------------------------------------------------------------ overall research confidence

export const CONFIDENCE_METHOD = [
  "GitHub identification (25): provided or confirmed by website 25 · name match only 8 · none 0",
  "Code coverage (25): ≥8 repositories analyzed 25 · 4–7 18 · 1–3 10 · none 0",
  "Source diversity (25): independent source families with findings (code, job postings, DNS, certificate logs, articles, web research) — 3+ → 25 · 2 → 18 · 1 → 10",
  "Recency (25): newest dated evidence ≤30 days 25 · ≤90 days 18 · ≤1 year 10 · older 4 · none 0",
  "Level: High ≥ 75 · Medium 45–74 · Low < 45. An unconfirmed GitHub match caps the level at Medium; no findings caps it at Low.",
];

export function scoreConfidence(input: { githubMethod: GithubMethod; reposAnalyzed: number; evidence: EvidenceItem[]; now?: number }): ConfidenceBreakdown {
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
  comps.push({ name: "Code coverage", points: r >= 8 ? 25 : r >= 4 ? 18 : r >= 1 ? 10 : 0, max: 25, reason: `${r} public repositories analyzed` });

  const fam: Record<EvidenceKind, string> = { code: "Code", repo_language: "Code", job_posting: "Job postings", dns: "DNS", subdomain: "Certificate logs", article: "Articles", web_research: "Web research" };
  const families = new Set(input.evidence.map((e) => fam[e.kind]));
  comps.push({ name: "Source diversity", points: families.size >= 3 ? 25 : families.size === 2 ? 18 : families.size === 1 ? 10 : 0, max: 25, reason: families.size ? [...families].join(", ") : "No source produced findings" });

  const newest = input.evidence.map((e) => (e.source.publishedAt ? Date.parse(e.source.publishedAt) : 0)).reduce((a, b) => Math.max(a, b), 0);
  const age = newest ? (now - newest) / DAY : Infinity;
  comps.push({ name: "Recency", points: !newest ? 0 : age <= 30 ? 25 : age <= 90 ? 18 : age <= 365 ? 10 : 4, max: 25, reason: newest ? `Newest evidence dated ${new Date(newest).toISOString().slice(0, 10)}` : "No dated evidence" });

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

// ------------------------------------------------------------------ change tracking

/** The parts of a saved snapshot that change tracking compares. */
export interface DiffInput {
  githubLogin: string | null;
  stack: Pick<StackItem, "tech" | "category" | "kinds" | "lastObservedAt" | "evidence">[];
  languages: Pick<LanguageShare, "name" | "pct">[];
  activity: Pick<Activity, "releases" | "new_repos_90d" | "level">;
  hiring: Pick<Hiring, "eng_open_roles" | "tech_mentions" | "sample_roles">;
}

/**
 * Compare two saved snapshots. "Newly observed" means it appeared in public evidence for the
 * first time — never that the company adopted it. Missing observations are reported as
 * "not re-observed", never as "stopped using".
 */
export function diffSnapshots(prev: DiffInput | null, cur: DiffInput, snapshotAt: string): ChangeItem[] {
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

  const key = (s: { category: Category; tech: string }) => techKey(s.category, s.tech);
  const prevTech = new Set(prev.stack.map(key));
  const curTech = new Set(cur.stack.map(key));
  for (const t of cur.stack) {
    if (prevTech.has(key(t))) continue;
    out.push({
      kind: t.category === "language" ? "new_language" : "new_technology",
      title: `Newly observed: ${t.tech}`,
      description: `First seen in public evidence (${t.kinds.map((k) => EVIDENCE_KIND_LABELS[k].toLowerCase()).join(", ")}). This is when it became visible, not necessarily when the company adopted it.`,
      date: t.lastObservedAt ?? snapshotAt,
      sourceUrl: t.evidence[0]?.url ?? null,
      category: t.category,
    });
  }

  const prevMentions = new Set(prev.hiring.tech_mentions.map((m) => m.tech));
  const newMentions = cur.hiring.tech_mentions.filter((m) => !prevMentions.has(m.tech));
  if (newMentions.length) {
    out.push({
      kind: "new_job_posting",
      title: `New technology requirements in job postings: ${newMentions.slice(0, 5).map((m) => m.tech).join(", ")}`,
      description: `Named in ${newMentions.map((m) => `${m.tech} (${m.count})`).slice(0, 5).join(", ")} current engineering postings, not in the previous snapshot.`,
      date: snapshotAt,
      sourceUrl: cur.hiring.sample_roles[0]?.url ?? null,
    });
  }
  const prevRoles = new Set(prev.hiring.sample_roles.map((r) => r.url));
  for (const r of cur.hiring.sample_roles.filter((r) => !prevRoles.has(r.url) && r.techs.length).slice(0, 3)) {
    out.push({ kind: "new_job_posting", title: `New technical job posting: ${r.title}`, description: `Mentions ${r.techs.join(", ")}.`, date: snapshotAt, sourceUrl: r.url });
  }
  const dRoles = cur.hiring.eng_open_roles - prev.hiring.eng_open_roles;
  if (prev.hiring.eng_open_roles > 0 || cur.hiring.eng_open_roles > 0) {
    if (Math.abs(dRoles) >= Math.max(3, prev.hiring.eng_open_roles * 0.15)) {
      out.push({
        kind: "hiring_change",
        title: `Engineering hiring ${dRoles > 0 ? "up" : "down"}: ${prev.hiring.eng_open_roles} → ${cur.hiring.eng_open_roles} open roles`,
        description: "Open engineering roles on the public job board.",
        date: snapshotAt,
        sourceUrl: null,
      });
    }
  }

  const prevRel = new Set(prev.activity.releases.map((r) => r.url));
  for (const r of cur.activity.releases.filter((r) => !prevRel.has(r.url)).slice(0, 5)) {
    out.push({ kind: "new_release", title: `New release: ${r.repo} ${r.tag}`, description: "Published on GitHub since the previous snapshot.", date: r.publishedAt, sourceUrl: r.url });
  }
  const prevRepos = new Set(prev.activity.new_repos_90d.map((r) => r.url));
  for (const r of cur.activity.new_repos_90d.filter((r) => !prevRepos.has(r.url)).slice(0, 5)) {
    out.push({ kind: "new_repository", title: `New public repository: ${r.name}`, description: "Created recently and visible for the first time.", date: r.created_at, sourceUrl: r.url });
  }

  const prevPct = new Map(prev.languages.map((l) => [l.name, l.pct]));
  for (const l of cur.languages) {
    const before = prevPct.get(l.name);
    if (before !== undefined && Math.abs(l.pct - before) >= 10) {
      out.push({
        kind: "language_shift",
        title: `${l.name} share ${l.pct > before ? "rose" : "fell"}: ${before.toFixed(0)}% → ${l.pct.toFixed(0)}%`,
        description: "Share of code bytes in recently active public repositories. Sample changes can move this number too.",
        date: snapshotAt,
        sourceUrl: null,
        category: "language",
      });
    }
  }

  if (prev.activity.level !== cur.activity.level) {
    out.push({ kind: "activity_change", title: `Public activity: ${prev.activity.level} → ${cur.activity.level}`, description: "Based on repository pushes and commit activity.", date: snapshotAt, sourceUrl: null });
  }

  for (const t of prev.stack) {
    if (curTech.has(key(t))) continue;
    out.push({
      kind: "not_reobserved",
      title: `Not re-observed: ${t.tech}`,
      description: "Not found in this refresh's evidence. This does not mean the company stopped using it — a posting may have closed or a repository may have left the sample.",
      date: snapshotAt,
      sourceUrl: t.evidence[0]?.url ?? null,
      category: t.category,
    });
  }
  return out;
}
