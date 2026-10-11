import { z } from "zod";
import { HttpError, RateLimitError, fetchWithTimeout, hostMatchesDomain, hostOf, mapLimit, sleep, withRetry } from "@/lib/http";
import {
  TERRAFORM_PROVIDERS,
  detectInDependencies,
  detectInPaths,
  detectInText,
  detectMultiServiceLayout,
  manifestKind,
  parseDependencies,
  serverlessProvider,
  techByName,
} from "@/lib/techDictionary";
import { DAY, UA } from "@/lib/collectors/common";
import type { Activity, ActivityLevel, EvidenceItem, GithubIdentification, LanguageShare, ReleaseInfo, SourceRef } from "@/lib/types";

const API = "https://api.github.com";

export interface HttpCache {
  get(url: string): Promise<{ etag: string | null; body: unknown } | null>;
  set(url: string, etag: string, body: unknown): Promise<void>;
}

// ------------------------------------------------------------------ response schemas (zod)

const profileSchema = z.object({
  login: z.string(),
  type: z.enum(["Organization", "User"]),
  name: z.string().nullable().optional(),
  blog: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  html_url: z.string(),
  public_repos: z.number().default(0),
});
export type GhProfile = { login: string; type: "Organization" | "User"; name: string | null; blog: string | null; email: string | null; html_url: string; public_repos: number };

const restRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  html_url: z.string(),
  description: z.string().nullable().optional(),
  fork: z.boolean(),
  archived: z.boolean(),
  size: z.number(),
  language: z.string().nullable().optional(),
  stargazers_count: z.number().default(0),
  pushed_at: z.string().nullable(),
  created_at: z.string(),
  default_branch: z.string(),
});

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable().optional(),
  html_url: z.string(),
  published_at: z.string().nullable(),
  draft: z.boolean(),
});
const contributorSchema = z.object({ login: z.string().optional(), type: z.string().optional() });
const weekSchema = z.object({ total: z.number(), week: z.number() });
const treeSchema = z.object({ truncated: z.boolean().optional(), tree: z.array(z.object({ path: z.string(), type: z.string() })) });

/** Normalised repository (GraphQL or REST). */
export interface GhRepo {
  name: string;
  fullName: string;
  url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  size: number;
  stars: number;
  pushedAt: string | null;
  createdAt: string;
  defaultBranch: string;
  languages: { name: string; size: number; color: string | null }[] | null; // null = not fetched
}

const parseList = <T,>(schema: z.ZodType<T>, data: unknown): T[] =>
  Array.isArray(data) ? data.map((d) => schema.safeParse(d)).flatMap((r) => (r.success ? [r.data] : [])) : [];

// ------------------------------------------------------------------ client

/**
 * Minimal GitHub client: auth, ETag conditional requests (304s don't count against the rate
 * limit), GraphQL, retries with backoff, explicit rate-limit errors (primary and secondary).
 */
export class GitHubClient {
  requests = 0;
  cacheHits = 0;
  rateRemaining: number | null = null;
  rateReset: Date | null = null;

  constructor(private opts: { token?: string; cache?: HttpCache; timeoutMs?: number } = {}) {}

  get authenticated() {
    return Boolean(this.opts.token);
  }

  private headers(extra: Record<string, string> = {}) {
    const h: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA, ...extra };
    if (this.opts.token) h.Authorization = `Bearer ${this.opts.token}`;
    return h;
  }

  private trackRate(res: Response) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const reset = res.headers.get("x-ratelimit-reset");
    if (remaining !== null) this.rateRemaining = Number(remaining);
    if (reset !== null) this.rateReset = new Date(Number(reset) * 1000);
  }

  private rateLimitError(res: Response, url: string): Error {
    const retryAfter = Number(res.headers.get("retry-after"));
    if (this.rateRemaining === 0 && this.rateReset) return new RateLimitError("GitHub", this.rateReset);
    if (retryAfter > 0) {
      if (retryAfter <= 30) return new HttpError(429, url, "GitHub secondary rate limit", retryAfter * 1000);
      return new RateLimitError("GitHub", new Date(Date.now() + retryAfter * 1000));
    }
    return new HttpError(res.status, url, `GitHub refused the request (${res.status})`);
  }

  /** GET an API path. Returns null for 404/409/451 (missing, empty repo, blocked). */
  async get<T = unknown>(path: string, { cache = false }: { cache?: boolean } = {}): Promise<T | null> {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const cached = cache && this.opts.cache ? await this.opts.cache.get(url).catch(() => null) : null;
    return withRetry(async () => {
      this.requests++;
      const res = await fetchWithTimeout(url, { headers: this.headers(cached?.etag ? { "If-None-Match": cached.etag } : {}), timeoutMs: this.opts.timeoutMs ?? 20_000 });
      this.trackRate(res);
      if (res.status === 304 && cached) {
        this.cacheHits++;
        return cached.body as T;
      }
      if (res.status === 404 || res.status === 409 || res.status === 451) return null;
      if (res.status === 403 || res.status === 429) throw this.rateLimitError(res, url);
      if (!res.ok) throw new HttpError(res.status, url, `GitHub API error ${res.status}`);
      const body = (await res.json()) as T;
      const etag = res.headers.get("etag");
      if (cache && etag && this.opts.cache) await this.opts.cache.set(url, etag, body).catch(() => undefined);
      return body;
    });
  }

  /** Repository statistics endpoints answer 202 while GitHub computes them: retry, then give up. */
  async stats<T = unknown>(path: string, tries = 3): Promise<T | null> {
    const url = `${API}${path}`;
    for (let i = 0; i < tries; i++) {
      this.requests++;
      let res: Response;
      try {
        res = await fetchWithTimeout(url, { headers: this.headers(), timeoutMs: 15_000 });
      } catch {
        return null; // statistics are supplementary: a network hiccup skips them
      }
      this.trackRate(res);
      if (res.status === 202) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(1000 * 2 ** i);
        continue;
      }
      if (res.status === 403 || res.status === 429) throw this.rateLimitError(res, url);
      if (!res.ok || res.status === 204) return null;
      return (await res.json().catch(() => null)) as T | null;
    }
    return null;
  }

  /** Like get(), but a non-rate-limit failure yields null (for supplementary data). */
  async optional<T = unknown>(path: string, opts: { cache?: boolean } = {}): Promise<T | null> {
    try {
      return await this.get<T>(path, opts);
    } catch (err) {
      if (err instanceof RateLimitError) throw err;
      return null;
    }
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    if (!this.opts.token) throw new Error("GitHub GraphQL requires GITHUB_TOKEN");
    return withRetry(async () => {
      this.requests++;
      const res = await fetchWithTimeout(`${API}/graphql`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
        timeoutMs: 30_000,
      });
      this.trackRate(res);
      if (res.status === 403 || res.status === 429) throw this.rateLimitError(res, `${API}/graphql`);
      if (!res.ok) throw new HttpError(res.status, `${API}/graphql`, `GitHub GraphQL error ${res.status}`);
      const j = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] };
      if (j.errors?.length && !j.data) {
        if (j.errors.some((e) => e.type === "RATE_LIMITED")) throw new RateLimitError("GitHub", this.rateReset ?? new Date(Date.now() + 3_600_000));
        throw new Error(`GitHub GraphQL: ${j.errors[0].message}`);
      }
      return j.data as T;
    });
  }

  /** raw.githubusercontent.com (not counted against the REST API limit). */
  async raw(fullName: string, ref: string, path: string, maxBytes = 300_000): Promise<string | null> {
    const url = `https://raw.githubusercontent.com/${fullName}/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    try {
      const res = await withRetry(() => fetchWithTimeout(url, { headers: { "User-Agent": UA }, timeoutMs: 12_000 }), { retries: 1 });
      if (!res.ok) return null;
      const text = await res.text();
      return text.length > maxBytes ? text.slice(0, maxBytes) : text;
    } catch {
      return null;
    }
  }

  async profile(login: string): Promise<GhProfile | null> {
    const raw = await this.get(`/users/${encodeURIComponent(login)}`, { cache: true });
    const p = profileSchema.safeParse(raw);
    if (!p.success) return null;
    return { ...p.data, name: p.data.name ?? null, blog: p.data.blog || null, email: p.data.email ?? null };
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
  const guesses = new Set<string>([base.replace(/[^a-z0-9]+/g, ""), base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), normalizeCompanyName(name)]);
  if (domain) guesses.add(domain.split(".")[0]);
  return [...guesses].filter((g) => /^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(g));
}

export function profileMatchesDomain(profile: Pick<GhProfile, "blog" | "email">, domain: string | null) {
  if (!domain) return false;
  if (hostMatchesDomain(hostOf(profile.blog), domain)) return true;
  const emailDomain = profile.email?.split("@")[1]?.toLowerCase() ?? null;
  return hostMatchesDomain(emailDomain, domain);
}

/** Brand label of a host: "engineering.shopify.com" → "shopify", "shopify.engineering" → "shopify". */
export function brandLabel(host: string | null) {
  if (!host) return null;
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length < 2) return null;
  const twoPartSuffix = parts.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]);
  return parts[parts.length - (twoPartSuffix ? 3 : 2)] ?? null;
}

/** Org website on a different TLD of the same brand (shopify.engineering, airbnb.tech). */
export function profileMatchesBrand(profile: Pick<GhProfile, "blog">, domain: string | null) {
  const a = brandLabel(hostOf(profile.blog));
  const b = brandLabel(domain);
  return Boolean(a && b && a.length >= 4 && a === b);
}

export async function identifyGithubOrg(
  gh: GitHubClient,
  company: { name: string; domain: string | null; github_org: string | null },
): Promise<{ ident: GithubIdentification; profile: GhProfile | null }> {
  const empty = (note: string, candidates: GithubIdentification["candidates"] = []) => ({
    ident: { login: null, method: "none" as const, profileUrl: null, displayName: null, blog: null, candidates, note },
    profile: null,
  });
  const toIdent = (p: GhProfile, method: GithubIdentification["method"], note: string, candidates: GithubIdentification["candidates"] = []) => ({
    ident: { login: p.login, method, profileUrl: p.html_url, displayName: p.name, blog: p.blog || null, candidates, note },
    profile: p,
  });

  if (company.github_org) {
    const p = await gh.profile(company.github_org);
    if (!p) return empty(`The GitHub account "${company.github_org}" saved for this company was not found on GitHub.`);
    return toIdent(p, "user_provided", "GitHub organization provided on the watchlist.");
  }

  const logins = new Set(loginGuesses(company.name, company.domain));
  const search = (await gh.get<{ items: { login: string }[] }>(`/search/users?q=${encodeURIComponent(`${company.name} type:org`)}&per_page=5`).catch(() => null)) ?? null;
  for (const item of search?.items ?? []) logins.add(item.login);

  const profiles = (await mapLimit([...logins].slice(0, 8), 4, (login) => gh.profile(login).catch(() => null))).filter(
    (p): p is GhProfile => Boolean(p && p.type === "Organization"),
  );
  const unique = [...new Map(profiles.map((p) => [p.login.toLowerCase(), p])).values()];
  const candidates = unique.map((p) => ({ login: p.login, name: p.name, blog: p.blog || null, url: p.html_url }));

  const target = normalizeCompanyName(company.name);
  const nameMatch = (p: GhProfile) => normalizeCompanyName(p.name ?? "") === target || normalizeCompanyName(p.login) === target;
  // Verified = website on the company's domain, or (name matches AND website is the same brand
  // on another TLD, e.g. Shopify → shopify.engineering). Name alone or brand alone is not enough.
  const verifiedBy = (p: GhProfile) => (profileMatchesDomain(p, company.domain) ? "domain" : nameMatch(p) && profileMatchesBrand(p, company.domain) ? "brand" : null);
  const rank = (p: GhProfile) => (verifiedBy(p) === "domain" ? 1 : 0) + (nameMatch(p) ? 2 : 0);
  const verified = unique.filter((p) => verifiedBy(p)).sort((a, b) => rank(b) - rank(a) || b.public_repos - a.public_repos)[0];
  if (verified) {
    const how =
      verifiedBy(verified) === "domain"
        ? `the GitHub organization's website (${verified.blog || verified.email}) is on ${company.domain}`
        : `the organization is named "${verified.name ?? verified.login}" and its website (${verified.blog}) is the same brand as ${company.domain}`;
    return toIdent(verified, "verified_domain", `Matched: ${how}.`, candidates);
  }

  const nameMatches = unique.filter(nameMatch).sort((a, b) => b.public_repos - a.public_repos);
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

// ------------------------------------------------------------------ repository listing

const REPOS_QUERY = `query($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 100, after: $after, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER, orderBy: {field: PUSHED_AT, direction: DESC}) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name nameWithOwner url description isArchived isFork diskUsage stargazerCount pushedAt createdAt
        defaultBranchRef { name }
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } }
      }
    }
  }
}`;

interface GqlRepos {
  repositoryOwner: {
    repositories: {
      totalCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: {
        name: string;
        nameWithOwner: string;
        url: string;
        description: string | null;
        isArchived: boolean;
        isFork: boolean;
        diskUsage: number | null;
        stargazerCount: number;
        pushedAt: string | null;
        createdAt: string;
        defaultBranchRef: { name: string } | null;
        languages: { edges: { size: number; node: { name: string; color: string | null } }[] };
      }[];
    };
  } | null;
}

/** All public non-fork repos (up to 300, most recently pushed first). GraphQL includes languages. */
async function listRepos(gh: GitHubClient, profile: GhProfile): Promise<GhRepo[]> {
  if (gh.authenticated) {
    const repos: GhRepo[] = [];
    let after: string | null = null;
    for (let page = 0; page < 3; page++) {
      const data: GqlRepos = await gh.graphql<GqlRepos>(REPOS_QUERY, { login: profile.login, after });
      const conn = data.repositoryOwner?.repositories;
      if (!conn) break;
      for (const n of conn.nodes) {
        repos.push({
          name: n.name,
          fullName: n.nameWithOwner,
          url: n.url,
          description: n.description,
          fork: n.isFork,
          archived: n.isArchived,
          size: n.diskUsage ?? 0,
          stars: n.stargazerCount,
          pushedAt: n.pushedAt,
          createdAt: n.createdAt,
          defaultBranch: n.defaultBranchRef?.name ?? "main",
          languages: n.languages.edges.map((e) => ({ name: e.node.name, size: e.size, color: e.node.color })),
        });
      }
      if (!conn.pageInfo.hasNextPage) break;
      after = conn.pageInfo.endCursor;
    }
    return repos;
  }
  // Unauthenticated fallback: REST listing (languages fetched later for analysed repos only).
  const base = profile.type === "Organization" ? `/orgs/${profile.login}/repos?type=public` : `/users/${profile.login}/repos?type=owner`;
  const repos: GhRepo[] = [];
  for (let page = 1; page <= 2; page++) {
    const batch = parseList(restRepoSchema, await gh.get(`${base}&sort=pushed&direction=desc&per_page=100&page=${page}`, { cache: true }));
    repos.push(
      ...batch.map((r) => ({
        name: r.name,
        fullName: r.full_name,
        url: r.html_url,
        description: r.description ?? null,
        fork: r.fork,
        archived: r.archived,
        size: r.size,
        stars: r.stargazers_count,
        pushedAt: r.pushed_at,
        createdAt: r.created_at,
        defaultBranch: r.default_branch,
        languages: null,
      })),
    );
    if (batch.length < 100) break;
  }
  return repos;
}

function pickRepos(active: GhRepo[], max: number) {
  const byPush = [...active].sort((a, b) => Date.parse(b.pushedAt ?? "0") - Date.parse(a.pushedAt ?? "0"));
  const picked = byPush.slice(0, Math.ceil(max * 0.6));
  for (const r of [...active].sort((a, b) => b.stars - a.stars)) {
    if (picked.length >= max) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked;
}

export function aggregateLanguages(repos: GhRepo[]): LanguageShare[] {
  const totals = new Map<string, { bytes: number; repos: number; color: string | null }>();
  for (const r of repos) {
    for (const l of r.languages ?? []) {
      const cur = totals.get(l.name) ?? { bytes: 0, repos: 0, color: l.color ?? techByName(l.name)?.color ?? null };
      cur.bytes += l.size;
      cur.repos += 1;
      totals.set(l.name, cur);
    }
  }
  const sum = [...totals.values()].reduce((s, l) => s + l.bytes, 0);
  return [...totals.entries()]
    .map(([name, l]) => ({ name, bytes: l.bytes, pct: sum ? Math.round((l.bytes / sum) * 1000) / 10 : 0, repos: l.repos, color: l.color }))
    .sort((a, b) => b.bytes - a.bytes);
}

export function activityLevel(a: Pick<Activity, "repos_listed" | "repos_active_30d" | "repos_active_90d" | "commits_90d" | "last_push_at">, now = Date.now()): { level: ActivityLevel; reason: string } {
  if (a.repos_listed === 0) return { level: "Not publicly found", reason: "No public repositories were found." };
  const commits = a.commits_90d ?? 0;
  if (a.repos_active_30d >= 5 || commits >= 300) return { level: "Very active", reason: `${a.repos_active_30d} repositories updated in 30 days; ${commits} commits in 90 days across sampled repositories.` };
  if (a.repos_active_30d >= 2 || commits >= 50) return { level: "Active", reason: `${a.repos_active_30d} repositories updated in 30 days; ${commits} commits in 90 days across sampled repositories.` };
  if (a.repos_active_90d >= 1) return { level: "Moderate", reason: `${a.repos_active_90d} repositories updated in the last 90 days.` };
  if (a.last_push_at && now - Date.parse(a.last_push_at) < 365 * DAY) return { level: "Low", reason: `Most recent public push was ${a.last_push_at.slice(0, 10)}.` };
  return { level: "No recent public activity", reason: "No public repository updates in the last 12 months." };
}

export function emptyActivity(level: ActivityLevel = "Not publicly found", reason = "No GitHub organization was identified."): Activity {
  return {
    org_url: null,
    repos_total: null,
    repos_listed: 0,
    repos_analyzed: 0,
    repos_active_30d: 0,
    repos_active_90d: 0,
    commits_52w: [],
    commits_90d: null,
    commit_repos_sampled: 0,
    contributors: null,
    releases_90d: 0,
    releases: [],
    new_repos_90d: [],
    most_active_repos: [],
    last_push_at: null,
    level,
    level_reason: reason,
  };
}

// ------------------------------------------------------------------ collection

export interface GithubCollection {
  evidence: EvidenceItem[];
  languages: LanguageShare[];
  recentLanguages: LanguageShare[];
  activity: Activity;
  sources: SourceRef[];
  notes: string[];
}

const SKIP_DIRS = /(^|\/)(node_modules|vendor|third_party|third-party|examples?|samples?|fixtures?|testdata|__tests__|test|tests|docs?|\.yarn)\//i;
const BOT = /\[bot\]$|^dependabot|^renovate|^github-actions/i;

export async function collectGithub(gh: GitHubClient, profile: GhProfile, { maxRepos = 10, now = Date.now() }: { maxRepos?: number; now?: number } = {}): Promise<GithubCollection> {
  const notes: string[] = [];
  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [{ url: profile.html_url, type: "github_org", title: `GitHub: ${profile.name ?? profile.login}`, publishedAt: null, metadata: { public_repos: profile.public_repos } }];

  const repos = (await listRepos(gh, profile)).filter((r) => !r.fork);
  if (profile.public_repos > repos.length) notes.push(`${repos.length} most recently updated of ${profile.public_repos} public repositories were analysed for languages and activity.`);
  const active = repos.filter((r) => !r.archived && r.size > 0);
  const pushed = (r: GhRepo) => (r.pushedAt ? Date.parse(r.pushedAt) : 0);
  const byPush = [...active].sort((a, b) => pushed(b) - pushed(a));
  const analyzed = pickRepos(active, maxRepos);
  const repoRef = (r: GhRepo): SourceRef => ({ url: r.url, type: "github_repo", title: r.fullName, publishedAt: r.pushedAt, metadata: { stars: r.stars, description: r.description } });

  // REST fallback: languages only for analysed repos.
  if (!gh.authenticated) {
    await mapLimit(analyzed, 4, async (r) => {
      const langs = (await gh.get<Record<string, number>>(`/repos/${r.fullName}/languages`, { cache: true })) ?? {};
      r.languages = Object.entries(langs).map(([name, size]) => ({ name, size, color: techByName(name)?.color ?? null }));
    });
  }
  const withLangs = active.filter((r) => r.languages);
  const languages = aggregateLanguages(withLangs);
  const recentLanguages = aggregateLanguages(withLangs.filter((r) => pushed(r) >= now - 180 * DAY));

  // Per-repository file scanning: trees, manifests, CI workflows, Terraform, Serverless.
  let truncatedTrees = 0;
  const reposWithDocker = new Set<string>();
  const reposWithProto = new Set<string>();
  const reposWithOrchestration = new Set<string>();

  await mapLimit(analyzed, 4, async (repo) => {
    sources.push(repoRef(repo));
    const ref = repoRef(repo);
    const tree = treeSchema.safeParse(await gh.get(`/repos/${repo.fullName}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`));
    if (!tree.success) return;
    if (tree.data.truncated) truncatedTrees++;
    const relevant = tree.data.tree.filter((t) => t.type === "blob").map((t) => t.path).filter((p) => !SKIP_DIRS.test(p));
    const fileUrl = (p: string) => `${repo.url}/blob/${repo.defaultBranch}/${p}`;

    for (const m of detectInPaths(relevant)) {
      if (m.def.name === "Docker") reposWithDocker.add(repo.fullName);
      if (m.def.name === "gRPC") reposWithProto.add(repo.fullName);
      if (m.def.name === "Kubernetes" || m.def.name === "Helm") reposWithOrchestration.add(repo.fullName);
      evidence.push({
        technology: m.def.name,
        category: m.def.category,
        kind: "code",
        source: ref,
        evidence: `${repo.fullName} contains ${m.paths.map((p) => `\`${p}\``).join(", ")}`,
        detail: { paths: m.paths, url: fileUrl(m.paths[0]) },
      });
    }
    const serviceDirs = detectMultiServiceLayout(relevant);
    if (serviceDirs) {
      evidence.push({
        technology: "Microservices",
        category: "architecture",
        kind: "code",
        source: ref,
        evidence: `${repo.fullName} has separate container definitions in ${serviceDirs.length}+ directories (${serviceDirs.slice(0, 4).join(", ")})`,
        detail: { dirs: serviceDirs },
      });
    }

    const manifests = relevant.filter((p) => manifestKind(p)).sort((a, b) => a.split("/").length - b.split("/").length).slice(0, 4);
    for (const path of manifests) {
      const content = await gh.raw(repo.fullName, repo.defaultBranch, path);
      if (!content) continue;
      for (const m of detectInDependencies(parseDependencies(manifestKind(path)!, content))) {
        evidence.push({
          technology: m.def.name,
          category: m.def.category,
          kind: "code",
          source: ref,
          evidence: `\`${path}\` in ${repo.fullName} declares ${m.deps.map((d) => `\`${d}\``).join(", ")}`,
          detail: { manifest: path, deps: m.deps, url: fileUrl(path) },
        });
      }
    }

    for (const path of relevant.filter((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)).slice(0, 3)) {
      const content = await gh.raw(repo.fullName, repo.defaultBranch, path, 120_000);
      if (!content) continue;
      for (const m of detectInText(content)) {
        if (!["cloud", "containers", "iac", "observability"].includes(m.def.category)) continue;
        evidence.push({
          technology: m.def.name,
          category: m.def.category,
          kind: "code",
          source: ref,
          evidence: `CI workflow \`${path}\` in ${repo.fullName}: "${m.snippet.slice(0, 160)}"`,
          detail: { workflow: path, url: fileUrl(path) },
        });
      }
    }

    // Terraform providers → cloud. A few shallow .tf files are enough to see the providers.
    for (const path of relevant.filter((p) => p.endsWith(".tf")).sort((a, b) => a.split("/").length - b.split("/").length).slice(0, 3)) {
      const content = await gh.raw(repo.fullName, repo.defaultBranch, path, 150_000);
      if (!content) continue;
      for (const p of TERRAFORM_PROVIDERS) {
        if (!p.re.test(content)) continue;
        const def = techByName(p.tech)!;
        evidence.push({
          technology: def.name,
          category: def.category,
          kind: "code",
          source: ref,
          evidence: `Terraform provider for ${p.tech} in \`${path}\` (${repo.fullName})`,
          detail: { terraform: path, url: fileUrl(path) },
        });
      }
    }
    const sls = relevant.find((p) => /(^|\/)serverless\.ya?ml$/.test(p));
    if (sls) {
      const content = await gh.raw(repo.fullName, repo.defaultBranch, sls, 80_000);
      const cloud = content ? serverlessProvider(content) : null;
      if (cloud) {
        const def = techByName(cloud)!;
        evidence.push({ technology: def.name, category: def.category, kind: "code", source: ref, evidence: `\`${sls}\` deploys to provider ${cloud} (${repo.fullName})`, detail: { url: fileUrl(sls) } });
      }
    }
  });
  if (truncatedTrees) notes.push(`${truncatedTrees} very large repositories could only be partially scanned (GitHub truncated the file list).`);

  // Org-level microservices heuristic: containers in several repos + orchestration + gRPC/proto.
  if (reposWithDocker.size >= 2 && reposWithOrchestration.size >= 1 && reposWithProto.size >= 1) {
    evidence.push({
      technology: "Microservices",
      category: "architecture",
      kind: "code",
      source: sources[0],
      evidence: `Likely microservices architecture: Dockerfiles in ${reposWithDocker.size} repositories, Kubernetes/Helm in ${[...reposWithOrchestration].slice(0, 2).join(", ")}, protobuf/gRPC in ${[...reposWithProto].slice(0, 2).join(", ")}`,
      detail: { docker: [...reposWithDocker], orchestration: [...reposWithOrchestration], proto: [...reposWithProto] },
    });
  }

  // Language evidence (repository statistics).
  for (const l of languages.filter((l) => l.pct >= 1).slice(0, 12)) {
    const def = techByName(l.name);
    const top = [...withLangs].sort((a, b) => (b.languages?.find((x) => x.name === l.name)?.size ?? 0) - (a.languages?.find((x) => x.name === l.name)?.size ?? 0))[0];
    const recent = recentLanguages.find((r) => r.name === l.name);
    evidence.push({
      technology: l.name,
      category: def?.category === "language" ? "language" : "language",
      kind: "repo_language",
      source: top ? repoRef(top) : sources[0],
      evidence: `${l.pct}% of code across ${withLangs.length} public repositories${recent ? ` (${recent.pct}% in repos pushed in the last 180 days)` : ""}; largest in ${top?.fullName ?? profile.login}`,
      detail: { pct: l.pct, recentPct: recent?.pct ?? null, repos: l.repos },
    });
  }

  // Activity: releases, 52-week commit activity, contributors.
  const topRecent = byPush.slice(0, 10);
  const releases: ReleaseInfo[] = [];
  await mapLimit(topRecent.slice(0, 6), 3, async (repo) => {
    for (const r of parseList(releaseSchema, await gh.optional(`/repos/${repo.fullName}/releases?per_page=20`, { cache: true }))) {
      if (r.draft || !r.published_at || Date.parse(r.published_at) < now - 180 * DAY) continue;
      releases.push({ repo: repo.fullName, tag: r.tag_name, name: r.name || r.tag_name, url: r.html_url, publishedAt: r.published_at });
    }
  });
  releases.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  for (const r of releases.slice(0, 10)) sources.push({ url: r.url, type: "github_release", title: `${r.repo} ${r.tag}`, publishedAt: r.publishedAt });

  const weekly = new Array<number>(52).fill(0);
  const perRepoCommits = new Map<string, number>();
  let sampled = 0;
  await mapLimit(topRecent, 3, async (repo) => {
    const weeks = parseList(weekSchema, await gh.stats(`/repos/${repo.fullName}/stats/commit_activity`));
    if (!weeks.length) return;
    sampled++;
    const last = weeks.slice(-52);
    last.forEach((w, i) => (weekly[52 - last.length + i] += w.total));
    perRepoCommits.set(repo.fullName, last.reduce((s, w) => s + w.total, 0));
  });
  let commits90: number | null = sampled ? weekly.slice(-13).reduce((s, n) => s + n, 0) : null;
  if (!sampled && topRecent.length) {
    // Stats still computing everywhere: fall back to counting recent commits directly.
    let n = 0;
    await mapLimit(topRecent.slice(0, 5), 3, async (repo) => {
      const list = await gh.optional<unknown[]>(`/repos/${repo.fullName}/commits?since=${new Date(now - 90 * DAY).toISOString()}&per_page=100`);
      n += Array.isArray(list) ? list.length : 0;
    });
    commits90 = n;
    notes.push("GitHub was still computing commit statistics, so commits were counted directly (capped at 100 per repository) and the 52-week chart is unavailable.");
  }

  const contributors = new Set<string>();
  await mapLimit(topRecent.slice(0, 5), 3, async (repo) => {
    for (const c of parseList(contributorSchema, await gh.optional(`/repos/${repo.fullName}/contributors?per_page=100&anon=false`, { cache: true }))) {
      if (c.login && c.type !== "Bot" && !BOT.test(c.login)) contributors.add(c.login);
    }
  });

  const metrics = {
    org_url: profile.html_url,
    repos_total: profile.public_repos ?? null,
    repos_listed: repos.length,
    repos_analyzed: analyzed.length,
    repos_active_30d: repos.filter((r) => pushed(r) >= now - 30 * DAY).length,
    repos_active_90d: repos.filter((r) => pushed(r) >= now - 90 * DAY).length,
    commits_52w: sampled ? weekly : [],
    commits_90d: commits90,
    commit_repos_sampled: sampled,
    contributors: topRecent.length ? contributors.size : null,
    releases_90d: releases.filter((r) => Date.parse(r.publishedAt) >= now - 90 * DAY).length,
    releases: releases.slice(0, 15),
    new_repos_90d: repos.filter((r) => Date.parse(r.createdAt) >= now - 90 * DAY).map((r) => ({ name: r.fullName, url: r.url, created_at: r.createdAt })).slice(0, 10),
    most_active_repos: byPush.slice(0, 5).map((r) => ({ name: r.fullName, url: r.url, pushed_at: r.pushedAt ?? r.createdAt, commits_52w: perRepoCommits.get(r.fullName) ?? null })),
    last_push_at: byPush[0]?.pushedAt ?? null,
  };
  const { level, reason } = activityLevel(metrics, now);
  return { evidence, languages, recentLanguages, activity: { ...metrics, level, level_reason: reason }, sources, notes };
}
