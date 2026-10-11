/**
 * Deterministic scoring (computed in code, never by the LLM). Formulas are documented in the
 * README and shown in the UI as breakdowns.
 */
import type { Activity, Confidence, EvidenceKind, Hiring, LanguageShare, ProductProfile, ScoreComponent, StackItem } from "@/lib/types";

/** log-scaled 0..1: 0 at 0, 1 at `full` (and above). */
export const logScale = (value: number | null | undefined, full: number) => (value && value > 0 ? Math.min(1, Math.log1p(value) / Math.log1p(full)) : 0);

/**
 * activity_score (0–100):
 *   commits in last 90 d (log, full at 1,500) ×30
 *   repos pushed in 30 d (log, full at 25)    ×15
 *   repos pushed in 90 d (log, full at 50)    ×10
 *   distinct contributors (log, full at 100)  ×15
 *   releases in 90 d (log, full at 20)        ×15
 *   open engineering roles (log, full at 50)  ×15
 * Very active orgs land at 80–100, dormant ones at 0–20.
 */
export function activityScore(activity: Activity, hiring: Pick<Hiring, "eng_open_roles">): { score: number; components: ScoreComponent[] } {
  const parts: [string, number, number, string][] = [
    ["Commits (90 d)", logScale(activity.commits_90d, 1500), 30, activity.commits_90d === null ? "not available" : `${activity.commits_90d} commits across ${activity.commit_repos_sampled} sampled repos`],
    ["Repos active (30 d)", logScale(activity.repos_active_30d, 25), 15, `${activity.repos_active_30d} repositories pushed`],
    ["Repos active (90 d)", logScale(activity.repos_active_90d, 50), 10, `${activity.repos_active_90d} repositories pushed`],
    ["Contributors", logScale(activity.contributors, 100), 15, activity.contributors === null ? "not available" : `${activity.contributors} distinct people in top repos`],
    ["Releases (90 d)", logScale(activity.releases_90d, 20), 15, `${activity.releases_90d} releases`],
    ["Open engineering roles", logScale(hiring.eng_open_roles, 50), 15, `${hiring.eng_open_roles} roles`],
  ];
  const components = parts.map(([name, v, max, detail]) => ({ name, points: Math.round(v * max), max, detail }));
  return { score: Math.min(100, components.reduce((s, c) => s + c.points, 0)), components };
}

const CONF_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.8, low: 0.4 };

/**
 * fit_score (0–100) — overlap with the product profile:
 *   Languages ×40: share of recently-active code (180 d; else all-time) in target languages,
 *                  full marks at ≥50%. Without GitHub data, target languages named in job
 *                  postings give up to 50% of the points.
 *   Clouds    ×30: best detected target cloud — high confidence 30, medium 24, low 12.
 *   Signals   ×30: target signals detected (high 1, medium 0.8, low 0.4 each), full at 3.
 */
export function fitScore(
  profile: Pick<ProductProfile, "target_languages" | "target_clouds" | "target_signals">,
  stack: StackItem[],
  recent: LanguageShare[],
  allTime: LanguageShare[],
  hiring: Pick<Hiring, "tech_mentions">,
): { score: number; components: ScoreComponent[] } {
  const lc = (s: string) => s.toLowerCase();
  const targetsL = new Set(profile.target_languages.map(lc));
  const langs = recent.length ? recent : allTime;
  const matchedLangs = langs.filter((l) => targetsL.has(lc(l.name)));
  let langPoints: number;
  let langDetail: string;
  if (langs.length) {
    const share = matchedLangs.reduce((s, l) => s + l.pct, 0);
    langPoints = Math.round(Math.min(1, share / 50) * 40);
    langDetail = matchedLangs.length
      ? `${matchedLangs.map((l) => `${l.name} ${l.pct}%`).join(", ")} of ${recent.length ? "recently active" : "all"} public code`
      : "No target languages in public code";
  } else {
    const named = hiring.tech_mentions.filter((t) => targetsL.has(lc(t.tech)));
    langPoints = Math.round(Math.min(1, named.length / 2) * 20);
    langDetail = named.length ? `No public code; job postings name ${named.map((t) => t.tech).join(", ")}` : "No language evidence";
  }

  const clouds = stack.filter((s) => profile.target_clouds.map(lc).includes(lc(s.tech)));
  const bestCloud = clouds.sort((a, b) => CONF_WEIGHT[b.confidence] - CONF_WEIGHT[a.confidence])[0];
  const cloudPoints = bestCloud ? { high: 30, medium: 24, low: 12 }[bestCloud.confidence] : 0;
  const cloudDetail = clouds.length ? clouds.map((c) => `${c.tech} (${c.confidence})`).join(", ") : "No target cloud detected";

  const signals = stack.filter((s) => profile.target_signals.map(lc).includes(lc(s.tech)));
  const signalSum = signals.reduce((s, x) => s + CONF_WEIGHT[x.confidence], 0);
  const signalPoints = Math.round(Math.min(1, signalSum / 3) * 30);
  const signalDetail = signals.length ? signals.map((s) => `${s.tech} (${s.confidence})`).join(", ") : "No target signals detected";

  const components: ScoreComponent[] = [
    { name: "Target languages", points: langPoints, max: 40, detail: langDetail },
    { name: "Target clouds", points: cloudPoints, max: 30, detail: cloudDetail },
    { name: "Target signals", points: signalPoints, max: 30, detail: signalDetail },
  ];
  return { score: components.reduce((s, c) => s + c.points, 0), components };
}

/** Independent evidence families: code/config, job postings, DNS, CT subdomains, articles, web research. */
export const FAMILY: Record<EvidenceKind, string> = {
  code: "code",
  repo_language: "code",
  job_posting: "jobs",
  dns: "dns",
  subdomain: "subdomain",
  article: "articles",
  web_research: "web",
};

/**
 * Per-technology confidence:
 *   high   = found in 2+ independent source families (e.g. Terraform AWS provider + job posts)
 *   medium = one strong source: public code/config, or 3+ job postings
 *   low    = weak signal only (a DNS record, one or two job mentions, an article, a subdomain)
 */
export function techConfidence(kinds: EvidenceKind[], jobPostings: number): { confidence: Confidence; reason: string } {
  const families = [...new Set(kinds.map((k) => FAMILY[k]))];
  if (families.length >= 2) return { confidence: "high", reason: `Confirmed by ${families.length} independent sources (${families.join(", ")})` };
  if (families[0] === "code") return { confidence: "medium", reason: "Found in public code or configuration" };
  if (families[0] === "jobs" && jobPostings >= 3) return { confidence: "medium", reason: `Named in ${jobPostings} engineering job postings` };
  return { confidence: "low", reason: `Single weak signal (${families[0] ?? "none"})` };
}
