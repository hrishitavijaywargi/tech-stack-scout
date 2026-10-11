import { HttpError, RateLimitError, fetchWithTimeout, hostMatchesDomain, hostOf, mapLimit, withRetry } from "@/lib/http";
import {
  detectInDependencies,
  detectInPaths,
  detectInText,
  detectMultiServiceLayout,
  manifestKind,
  parseDependencies,
} from "@/lib/research/catalog";
import type {
  ActivityLevel,
  ActivityMetrics,
  EvidenceItem,
  GithubIdentification,
  LanguageShare,
  ReleaseInfo,
  SourceRef,
} from "@/lib/types";

const API = "https://api.github.com";
const DAY = 86_400_000;

export interface HttpCache {
  get(url: string): Promise<{ etag: string | null; body: unknown } | null>;
  set(url: string, etag: string, body: unknown): Promise<void>;
}

export interface GhProfile {
  login: string;
  type: "Organization" | "User";
  name: string | null;
  blog: string | null;
  email: string | null;
  html_url: string;
  public_repos: number;
  description?: string | null;
  bio?: string | null;
}

export interface GhRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  size: number;
  language: string | null;
  stargazers_count: number;
  pushed_at: string | null;
  created_at: string;
  default_branch: string;
  topics?: string[];
}

/**
 * Minimal GitHub REST client: auth, ETag conditional requests (304s don't count against
 * the rate limit), retries with backoff, and explicit rate-limit errors.
 */
export class GitHubClient {
  requests = 0;
  cacheHits = 0;
  rateRemaining: number | null = null;
  rateReset: Date | null = null;

  constructor(
    private opts: { token?: string; cache?: HttpCache; timeoutMs?: number } = {},
  ) {}

  get authenticated() {
    return Boolean(this.opts.token);
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tech-stack-scout",
      ...extra,
    };
    if (this.opts.token) h.Authorization = `Bearer ${this.opts.token}`;
    return h;
  }

  /** GET an API path. Returns null for 404/409/451 (missing, empty repo, blocked). */
  async get<T>(path: string, { cache = false }: { cache?: boolean } = {}): Promise<T | null> {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const cached = cache && this.opts.cache ? await this.opts.cache.get(url).catch(() => null) : null;

    return withRetry(async () => {
      this.requests++;
      const res = await fetchWithTimeout(url, {
        headers: this.headers(cached?.etag ? { "If-None-Match": cached.etag } : {}),
        timeoutMs: this.opts.timeoutMs ?? 20_000,
      });
      this.trackRate(res);

      if (res.status === 304 && cached) {
        this.cacheHits++;
        return cached.body as T;
      }
      if (res.status === 404 || res.status === 409 || res.status === 451) return null;
      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get("retry-after"));
        if (this.rateRemaining === 0 && this.rateReset) throw new RateLimitError("GitHub", this.rateReset);
        if (retryAfter > 0) {
          // Secondary rate limit: wait if short, otherwise surface as a rate-limit error.
          if (retryAfter <= 30) throw new HttpError(429, url, "GitHub secondary rate limit", retryAfter * 1000);
          throw new RateLimitError("GitHub", new Date(Date.now() + retryAfter * 1000));
        }
        throw new HttpError(res.status, url, `GitHub refused the request (${res.status})`);
      }
      if (!res.ok) throw new HttpError(res.status, url, `GitHub API error ${res.status}`);

      const body = (await res.json()) as T;
      const etag = res.headers.get("etag");
      if (cache && etag && this.opts.cache) await this.opts.cache.set(url, etag, body).catch(() => undefined);
      return body;
    });
  }

  /** Fetch a file from raw.githubusercontent.com (not counted against the REST API limit). */
  async raw(fullName: string, ref: string, path: string, maxBytes = 300_000): Promise<string | null> {
    const url = `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const res = await withRetry(() => fetchWithTimeout(url, { headers: { "User-Agent": "tech-stack-scout" }, timeoutMs: 12_000 }), {
        retries: 1,
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > maxBytes ? text.slice(0, maxBytes) : text;
    } catch {
      return null;
    }
  }

  private trackRate(res: Response) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) this.rateRemaining = Number(remaining);
    if (reset !== null) this.rateReset = new Date(Number(reset) * 1000);
  }
}

// ------------------------------------------------------------------ organisation identification

const CORP_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|pvt|private|technologies|technology|labs|hq|ai|io|software|systems)\b/g;

export function normalizeCompanyName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'’"()]/g, " ")
    .replace(CORP_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, "");
}

export function loginGuesses(name: string, domain: string | null) {
  const base = name.toLowerCase().replace(/[.,'’"()]/g, "").trim();
  const guesses = new Set<string>([
    base.replace(/[^a-z0-9]+/g, ""),
    base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    normalizeCompanyName(name),
  ]);
  if (domain) guesses.add(domain.split(".")[0]);
  return [...guesses].filter((g) => /^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(g));
}

/** Does a GitHub profile point at the company's website (blog field or public email)? */
export function profileMatchesDomain(profile: Pick<GhProfile, "blog" | "email">, domain: string | null) {
  if (!domain) return false;
  if (hostMatchesDomain(hostOf(profile.blog), domain)) return true;
  const emailDomain = profile.email?.split("@")[1]?.toLowerCase() ?? null;
  return hostMatchesDomain(emailDomain, domain);
}

export async function identifyGithubOrg(
  gh: GitHubClient,
  company: { name: string; domain: string | null; github_org: string | null },
): Promise<{ ident: GithubIdentification; profile: GhProfile | null }> {
  const empty = (note: string, candidates: GithubIdentification["candidates"] = []): { ident: GithubIdentification; profile: null } => ({
    ident: { login: null, method: "none", profileUrl: null, displayName: null, blog: null, candidates, note },
    profile: null,
  });
  const toIdent = (p: GhProfile, method: GithubIdentification["method"], note: string, candidates: GithubIdentification["candidates"] = []) => ({
    ident: { login: p.login, method, profileUrl: p.html_url, displayName: p.name, blog: p.blog || null, candidates, note },
    profile: p,
  });

  if (company.github_org) {
    const p = await gh.get<GhProfile>(`/users/${encodeURIComponent(company.github_org)}`, { cache: true });
    if (!p) return empty(`The GitHub account "${company.github_org}" saved for this company was not found on GitHub.`);
    return toIdent(p, "user_provided", "GitHub organization provided on the watchlist.");
  }

  // Candidate discovery: direct guesses + GitHub organization search.
  const logins = new Set(loginGuesses(company.name, company.domain));
  const search = await gh
    .get<{ items: { login: string }[] }>(`/search/users?q=${encodeURIComponent(`${company.name} type:org`)}&per_page=5`)
    .catch(() => null);
  for (const item of search?.items ?? []) logins.add(item.login);

  const profiles = (
    await mapLimit([...logins].slice(0, 8), 4, (login) => gh.get<GhProfile>(`/users/${encodeURIComponent(login)}`, { cache: true }).catch(() => null))
  ).filter((p): p is GhProfile => Boolean(p && p.type === "Organization"));

  const unique = [...new Map(profiles.map((p) => [p.login.toLowerCase(), p])).values()];
  const candidates = unique.map((p) => ({ login: p.login, name: p.name, blog: p.blog || null, url: p.html_url }));

  const verified = unique.find((p) => profileMatchesDomain(p, company.domain));
  if (verified) {
    return toIdent(verified, "verified_domain", `Matched: the GitHub organization's website (${verified.blog || verified.email}) is on ${company.domain}.`, candidates);
  }

  const target = normalizeCompanyName(company.name);
  const nameMatches = unique
    .filter((p) => normalizeCompanyName(p.name ?? "") === target || normalizeCompanyName(p.login) === target)
    .sort((a, b) => b.public_repos - a.public_repos);
  if (nameMatches.length) {
    const p = nameMatches[0];
    return toIdent(
      p,
      "name_match_unconfirmed",
      company.domain
        ? `Unconfirmed: "${p.login}" matches the company name, but its profile does not link to ${company.domain}. Confirm it before relying on this report.`
        : `Unconfirmed: "${p.login}" matches the company name only. Add the company's website or confirm the GitHub organization.`,
      candidates,
    );
  }

  return empty(
    candidates.length
      ? "GitHub organizations with similar names exist, but none could be linked to this company. Confirm one to include GitHub evidence."
      : "No public GitHub organization found for this company.",
    candidates,
  );
}

// ------------------------------------------------------------------ evidence collection

export interface GithubCollection {
  evidence: EvidenceItem[];
  languages: LanguageShare[];
  activity: ActivityMetrics;
  sources: SourceRef[];
  notes: string[];
}

const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|third-party|examples?|samples?|fixtures?|testdata|__tests__|test|tests|docs?|\.yarn)\//i;

function pickRepos(repos: GhRepo[], max: number) {
  const active = repos.filter((r) => !r.fork && !r.archived && r.size > 0);
  const byPush = [...active].sort((a, b) => Date.parse(b.pushed_at ?? "0") - Date.parse(a.pushed_at ?? "0"));
  const recentN = Math.ceil(max * 0.6);
  const picked = byPush.slice(0, recentN);
  const byStars = [...active].sort((a, b) => b.stargazers_count - a.stargazers_count);
  for (const r of byStars) {
    if (picked.length >= max) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

export function activityLevel(m: Pick<ActivityMetrics, "reposListed" | "reposPushed30d" | "reposPushed90d" | "commits30d" | "lastPushAt">, now = Date.now()): { level: ActivityLevel; reason: string } {
  if (m.reposListed === 0) return { level: "Not publicly found", reason: "No public repositories were found." };
  const commits = m.commits30d ?? 0;
  if (m.reposPushed30d >= 5 || commits >= 50)
    return { level: "Very active", reason: `${m.reposPushed30d} repositories updated and ${commits}+ commits sampled in the last 30 days.` };
  if (m.reposPushed30d >= 2 || commits >= 10)
    return { level: "Active", reason: `${m.reposPushed30d} repositories updated and ${commits} commits sampled in the last 30 days.` };
  if (m.reposPushed90d >= 1) return { level: "Moderate", reason: `${m.reposPushed90d} repositories updated in the last 90 days.` };
  if (m.lastPushAt && now - Date.parse(m.lastPushAt) < 365 * DAY)
    return { level: "Low", reason: `Most recent public push was ${m.lastPushAt.slice(0, 10)}.` };
  return { level: "No recent public activity", reason: "No public repository updates in the last 12 months." };
}

export async function collectGithub(
  gh: GitHubClient,
  profile: GhProfile,
  { maxRepos = 10, now = Date.now() }: { maxRepos?: number; now?: number } = {},
): Promise<GithubCollection> {
  const login = profile.login;
  const notes: string[] = [];
  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [
    { url: profile.html_url, type: "github_org", title: `GitHub: ${profile.name ?? login}`, publishedAt: null, metadata: { public_repos: profile.public_repos } },
  ];

  // Repositories (most recently pushed first; up to 200).
  const base = profile.type === "Organization" ? `/orgs/${login}/repos?type=public` : `/users/${login}/repos?type=owner`;
  const repos: GhRepo[] = [];
  for (let page = 1; page <= 2; page++) {
    const batch = await gh.get<GhRepo[]>(`${base}&sort=pushed&direction=desc&per_page=100&page=${page}`, { cache: true });
    if (!batch?.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  if (profile.public_repos > repos.length) notes.push(`Only the ${repos.length} most recently updated of ${profile.public_repos} public repositories were listed.`);

  const analyzed = pickRepos(repos, maxRepos);
  const repoRef = (r: GhRepo): SourceRef => ({
    url: r.html_url,
    type: "github_repo",
    title: r.full_name,
    publishedAt: r.pushed_at,
    metadata: { stars: r.stargazers_count, language: r.language, description: r.description },
  });

  // Per-repository: languages, file tree, manifests, CI workflows.
  const langTotals = new Map<string, { bytes: number; repos: number; top: { name: string; url: string; bytes: number } | null }>();
  let truncatedTrees = 0;

  await mapLimit(analyzed, 4, async (repo) => {
    sources.push(repoRef(repo));
    const ref = repoRef(repo);

    const langs = await gh.get<Record<string, number>>(`/repos/${repo.full_name}/languages`, { cache: true });
    for (const [name, bytes] of Object.entries(langs ?? {})) {
      const cur = langTotals.get(name) ?? { bytes: 0, repos: 0, top: null };
      cur.bytes += bytes;
      cur.repos += 1;
      if (!cur.top || bytes > cur.top.bytes) cur.top = { name: repo.full_name, url: repo.html_url, bytes };
      langTotals.set(name, cur);
    }

    const tree = await gh.get<{ tree: { path: string; type: string }[]; truncated: boolean }>(
      `/repos/${repo.full_name}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
    );
    if (!tree) return;
    if (tree.truncated) truncatedTrees++;
    const paths = tree.tree.filter((t) => t.type === "blob").map((t) => t.path);
    const relevant = paths.filter((p) => !SKIP_DIRS.test(p));

    for (const m of detectInPaths(relevant)) {
      evidence.push({
        technology: m.def.name,
        category: m.def.category,
        kind: "code",
        source: ref,
        evidence: `${repo.full_name} contains ${m.paths.map((p) => `\`${p}\``).join(", ")}`,
        detail: { paths: m.paths },
      });
    }
    const serviceDirs = detectMultiServiceLayout(relevant);
    if (serviceDirs) {
      evidence.push({
        technology: "Microservices",
        category: "architecture",
        kind: "code",
        source: ref,
        evidence: `${repo.full_name} has separate container definitions in ${serviceDirs.length}+ directories (${serviceDirs.slice(0, 4).join(", ")})`,
        detail: { dirs: serviceDirs },
      });
    }

    // Manifests (shallowest first) → dependency-based detection.
    const manifests = relevant
      .filter((p) => manifestKind(p))
      .sort((a, b) => a.split("/").length - b.split("/").length)
      .slice(0, 4);
    for (const path of manifests) {
      const content = await gh.raw(repo.full_name, repo.default_branch, path);
      if (!content) continue;
      const deps = parseDependencies(manifestKind(path)!, content);
      for (const m of detectInDependencies(deps)) {
        evidence.push({
          technology: m.def.name,
          category: m.def.category,
          kind: "code",
          source: ref,
          evidence: `\`${path}\` in ${repo.full_name} declares ${m.deps.map((d) => `\`${d}\``).join(", ")}`,
          detail: { manifest: path, deps: m.deps },
        });
      }
    }

    // CI workflows → cloud / infrastructure references (deploy targets, IaC, containers).
    const workflows = relevant.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 3);
    for (const path of workflows) {
      const content = await gh.raw(repo.full_name, repo.default_branch, path, 120_000);
      if (!content) continue;
      for (const m of detectInText(content)) {
        if (m.def.category !== "cloud" && m.def.category !== "infrastructure") continue;
        evidence.push({
          technology: m.def.name,
          category: m.def.category,
          kind: "code",
          source: ref,
          evidence: `CI workflow \`${path}\` in ${repo.full_name}: "${m.snippet.slice(0, 160)}"`,
          detail: { workflow: path },
        });
      }
    }
  });
  if (truncatedTrees) notes.push(`${truncatedTrees} very large repositories could only be partially scanned (GitHub truncated the file list).`);

  // Languages by bytes across analysed repositories.
  const totalBytes = [...langTotals.values()].reduce((s, l) => s + l.bytes, 0);
  const languages: LanguageShare[] = [...langTotals.entries()]
    .map(([name, l]) => ({ name, bytes: l.bytes, share: totalBytes ? l.bytes / totalBytes : 0, repos: l.repos, topRepo: l.top ? { name: l.top.name, url: l.top.url } : null }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const l of languages.filter((l) => l.share >= 0.01).slice(0, 12)) {
    const top = analyzed.find((r) => r.full_name === l.topRepo?.name);
    evidence.push({
      technology: l.name,
      category: "language",
      kind: "repo_language",
      source: top ? repoRef(top) : sources[0],
      evidence: `${(l.share * 100).toFixed(1)}% of code across ${analyzed.length} analyzed public repositories (in ${l.repos}; largest in ${l.topRepo?.name})`,
      detail: { share: l.share, repos: l.repos, bytes: l.bytes },
    });
  }

  // Activity: pushes, new repositories, releases, commits.
  const since30 = now - 30 * DAY;
  const since90 = now - 90 * DAY;
  const pushed = (r: GhRepo) => (r.pushed_at ? Date.parse(r.pushed_at) : 0);
  const nonFork = repos.filter((r) => !r.fork);
  const recent = [...nonFork].sort((a, b) => pushed(b) - pushed(a));

  const releaseRepos = recent.filter((r) => !r.archived).slice(0, 6);
  const releases: ReleaseInfo[] = [];
  await mapLimit(releaseRepos, 3, async (repo) => {
    const rel = await gh.get<{ tag_name: string; name: string | null; html_url: string; published_at: string | null; draft: boolean; prerelease: boolean }[]>(
      `/repos/${repo.full_name}/releases?per_page=5`,
      { cache: true },
    );
    for (const r of rel ?? []) {
      if (r.draft || !r.published_at || Date.parse(r.published_at) < now - 180 * DAY) continue;
      releases.push({ repo: repo.full_name, tag: r.tag_name, name: r.name || r.tag_name, url: r.html_url, publishedAt: r.published_at });
    }
  });
  releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  for (const r of releases.slice(0, 10)) {
    sources.push({ url: r.url, type: "github_release", title: `${r.repo} ${r.tag}`, publishedAt: r.publishedAt });
  }

  const commitRepos = recent.filter((r) => pushed(r) >= since30).slice(0, 5);
  let commits = 0;
  let capped = false;
  const committers = new Set<string>();
  const perRepoCommits = new Map<string, number>();
  await mapLimit(commitRepos, 3, async (repo) => {
    const list = await gh.get<{ author: { login: string } | null; commit: { author: { name: string } | null } }[]>(
      `/repos/${repo.full_name}/commits?since=${new Date(since30).toISOString()}&per_page=100`,
    );
    const n = list?.length ?? 0;
    if (n === 100) capped = true;
    commits += n;
    perRepoCommits.set(repo.full_name, n);
    for (const c of list ?? []) {
      const who = c.author?.login ?? c.commit.author?.name;
      if (who && !/\[bot\]$|^dependabot|^renovate/i.test(who)) committers.add(who);
    }
  });

  const metrics = {
    orgUrl: profile.html_url,
    reposTotal: profile.public_repos ?? null,
    reposListed: repos.length,
    reposAnalyzed: analyzed.length,
    reposPushed30d: nonFork.filter((r) => pushed(r) >= since30).length,
    reposPushed90d: nonFork.filter((r) => pushed(r) >= since90).length,
    newRepos90d: nonFork
      .filter((r) => Date.parse(r.created_at) >= since90)
      .map((r) => ({ name: r.full_name, url: r.html_url, createdAt: r.created_at }))
      .slice(0, 10),
    commits30d: commitRepos.length ? commits : 0,
    commits30dCapped: capped,
    committers30d: commitRepos.length ? committers.size : 0,
    commitReposSampled: commitRepos.length,
    releases180d: releases.slice(0, 15),
    lastPushAt: recent[0]?.pushed_at ?? null,
    mostActiveRepos: recent.slice(0, 5).map((r) => ({
      name: r.full_name,
      url: r.html_url,
      pushedAt: r.pushed_at ?? r.created_at,
      commits30d: perRepoCommits.get(r.full_name) ?? null,
    })),
  };
  const { level, reason } = activityLevel(metrics, now);

  return { evidence, languages, activity: { ...metrics, level, levelReason: reason }, sources, notes };
}

export function emptyActivity(level: ActivityLevel = "Not publicly found", reason = "No GitHub organization was identified."): ActivityMetrics {
  return {
    orgUrl: null,
    reposTotal: null,
    reposListed: 0,
    reposAnalyzed: 0,
    reposPushed30d: 0,
    reposPushed90d: 0,
    newRepos90d: [],
    commits30d: null,
    commits30dCapped: false,
    committers30d: null,
    commitReposSampled: 0,
    releases180d: [],
    lastPushAt: null,
    mostActiveRepos: [],
    level,
    levelReason: reason,
  };
}
