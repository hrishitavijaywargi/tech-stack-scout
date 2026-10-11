import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, brandLabel, collectGithub, identifyGithubOrg, normalizeCompanyName, profileMatchesBrand, type GhProfile } from "@/lib/sources/github";
import { discoverFeedLinks, parseFeed } from "@/lib/sources/articles";
import { parseCareersUrl } from "@/lib/sources/jobs";
import { RateLimitError } from "@/lib/http";

/** Route-based fetch mock: first matching regex wins. */
function mockFetch(routes: [RegExp, (url: string) => Response][]) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [re, fn] of routes) if (re.test(url)) return fn(url);
    return new Response("not found", { status: 404 });
  });
  return calls;
}
const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

afterEach(() => vi.unstubAllGlobals());

const NOW = Date.parse("2026-10-11T00:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("identifyGithubOrg", () => {
  it("verifies an org whose profile links to the company website", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [{ login: "acme-corp" }] })],
      [/\/users\/acme-corp$/, () => json({ login: "acme-corp", type: "Organization", name: "Acme", blog: "https://www.acme.io", email: null, html_url: "https://github.com/acme-corp", public_repos: 12 })],
      [/\/users\/acme$/, () => json({ login: "acme", type: "Organization", name: "ACME Games", blog: "https://acme.games", email: null, html_url: "https://github.com/acme", public_repos: 50 })],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Acme", domain: "acme.io", github_org: null });
    expect(ident.method).toBe("verified_domain");
    expect(ident.login).toBe("acme-corp");
    expect(ident.candidates.length).toBe(2);
  });

  it("prefers the name-matching, larger org when several link to the website", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [{ login: "ShopifyUS" }, { login: "Shopify" }] })],
      [/\/users\/ShopifyUS$/, () => json({ login: "ShopifyUS", type: "Organization", name: "Shopify US", blog: "https://shopify.com", email: null, html_url: "https://github.com/ShopifyUS", public_repos: 2 })],
      [/\/users\/(S|s)hopify$/, () => json({ login: "Shopify", type: "Organization", name: "Shopify", blog: "https://www.shopify.com", email: null, html_url: "https://github.com/Shopify", public_repos: 1500 })],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Shopify", domain: "shopify.com", github_org: null });
    expect(ident.login).toBe("Shopify");
    expect(ident.method).toBe("verified_domain");
  });

  it("verifies a name-matching org whose site is the same brand on another TLD (shopify.engineering)", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [{ login: "Shopify-Partners" }, { login: "Shopify" }] })],
      [/\/users\/Shopify-Partners$/, () => json({ login: "Shopify-Partners", type: "Organization", name: "Shopify Partners", blog: "https://shopify.com", email: null, html_url: "https://github.com/Shopify-Partners", public_repos: 2 })],
      [/\/users\/(S|s)hopify$/, () => json({ login: "Shopify", type: "Organization", name: "Shopify", blog: "https://shopify.engineering/", email: null, html_url: "https://github.com/Shopify", public_repos: 1500 })],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Shopify", domain: "shopify.com", github_org: null });
    expect(ident.login).toBe("Shopify");
    expect(ident.method).toBe("verified_domain");
    expect(ident.note).toMatch(/same brand/);
  });

  it("does not verify a same-brand site when the name does not match", () => {
    expect(brandLabel("engineering.shopify.com")).toBe("shopify");
    expect(brandLabel("acme.co.uk")).toBe("acme");
    expect(profileMatchesBrand({ blog: "https://acme.games" }, "acme.io")).toBe(true); // brand alone…
    // …but identifyGithubOrg also requires the name to match (covered by the "ACME Games" case above).
  });

  it("marks a name-only match as unconfirmed", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [] })],
      [/\/users\/acme$/, () => json({ login: "acme", type: "Organization", name: "Acme", blog: "", email: null, html_url: "https://github.com/acme", public_repos: 5 })],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Acme Inc.", domain: "acme.com", github_org: null });
    expect(ident.method).toBe("name_match_unconfirmed");
    expect(ident.note).toMatch(/Unconfirmed/);
  });

  it("reports a missing user-provided org instead of guessing", async () => {
    mockFetch([]);
    const { ident, profile } = await identifyGithubOrg(new GitHubClient(), { name: "Acme", domain: null, github_org: "nope" });
    expect(profile).toBeNull();
    expect(ident.method).toBe("none");
  });

  it("raises RateLimitError when the limit is exhausted", async () => {
    mockFetch([[/api\.github\.com/, () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(NOW / 1000 + 600) } })]]);
    await expect(identifyGithubOrg(new GitHubClient(), { name: "Acme", domain: null, github_org: "acme" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("normalises corporate suffixes", () => {
    expect(normalizeCompanyName("Acme Technologies, Inc.")).toBe("acme");
  });
});

describe("collectGithub", () => {
  it("collects languages, code evidence, releases and activity from real-shaped API data", async () => {
    const repo = (name: string, pushed: number, extra = {}) => ({
      name,
      full_name: `acme/${name}`,
      html_url: `https://github.com/acme/${name}`,
      description: null,
      fork: false,
      archived: false,
      size: 100,
      language: "Go",
      stargazers_count: 10,
      pushed_at: day(pushed),
      created_at: day(400),
      default_branch: "main",
      ...extra,
    });
    mockFetch([
      [/\/orgs\/acme\/repos/, () => json([repo("api", 2), repo("web", 5), repo("old", 500), repo("new-svc", 1, { created_at: day(10) }), repo("fork", 1, { fork: true })])],
      [/\/repos\/acme\/api\/languages/, () => json({ Go: 9000, Shell: 100 })],
      [/\/repos\/acme\/web\/languages/, () => json({ TypeScript: 3000 })],
      [/\/languages$/, () => json({})],
      [/\/repos\/acme\/api\/git\/trees/, () => json({ truncated: false, tree: [{ path: "Dockerfile", type: "blob" }, { path: "deploy/main.tf", type: "blob" }, { path: "go.mod", type: "blob" }, { path: ".github/workflows/deploy.yml", type: "blob" }] })],
      [/\/git\/trees/, () => json({ truncated: false, tree: [] })],
      [/raw\.githubusercontent\.com\/acme\/api\/main\/go\.mod/, () => new Response("module acme\nrequire github.com/aws/aws-sdk-go-v2 v1.24.0\n")],
      [/raw\.githubusercontent\.com\/acme\/api\/main\/\.github\/workflows\/deploy\.yml/, () => new Response("steps:\n  - uses: aws-actions/configure-aws-credentials@v4\n  - run: kubectl apply -f k8s/")],
      [/\/repos\/acme\/api\/releases/, () => json([{ tag_name: "v1.2.0", name: "v1.2.0", html_url: "https://github.com/acme/api/releases/v1.2.0", published_at: day(3), draft: false, prerelease: false }])],
      [/\/releases/, () => json([])],
      [/\/repos\/acme\/api\/commits/, () => json(Array.from({ length: 12 }, (_, i) => ({ author: { login: `dev${i % 3}` }, commit: { author: { name: "x" } } })))],
      [/\/commits/, () => json([{ author: { login: "dependabot[bot]" }, commit: { author: null } }])],
    ]);
    const profile: GhProfile = { login: "acme", type: "Organization", name: "Acme", blog: null, email: null, html_url: "https://github.com/acme", public_repos: 5 };
    const col = await collectGithub(new GitHubClient(), profile, { maxRepos: 5, now: NOW });

    expect(col.languages[0]).toMatchObject({ name: "Go" });
    const techs = new Set(col.evidence.map((e) => e.technology));
    for (const t of ["Go", "TypeScript", "Docker", "Terraform", "GitHub Actions", "AWS", "Kubernetes"]) expect(techs).toContain(t);
    expect(col.activity.reposListed).toBe(5);
    expect(col.activity.reposAnalyzed).toBe(4); // fork excluded
    expect(col.activity.releases180d).toHaveLength(1);
    expect(col.activity.newRepos90d.map((r) => r.name)).toEqual(["acme/new-svc"]);
    expect(col.activity.committers30d).toBe(3); // bots excluded
    expect(["Active", "Very active"]).toContain(col.activity.level);
    expect(col.evidence.every((e) => e.source.url.startsWith("https://github.com/"))).toBe(true);
  });
});

describe("feeds and job boards", () => {
  it("parses RSS and Atom feeds", () => {
    const rss = parseFeed(`<?xml version="1.0"?><rss><channel><title>Eng</title><item><title>Moving to Kubernetes</title><link>https://acme.com/a</link><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;We migrated&lt;/p&gt;</description></item></channel></rss>`);
    expect(rss?.articles[0]).toMatchObject({ title: "Moving to Kubernetes", url: "https://acme.com/a" });
    const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Go at scale</title><link rel="alternate" href="https://acme.com/b"/><updated>2026-09-02T00:00:00Z</updated></entry></feed>`);
    expect(atom?.articles[0]).toMatchObject({ title: "Go at scale", url: "https://acme.com/b" });
    expect(parseFeed("<html><body>hi</body></html>")).toBeNull();
  });

  it("discovers feed links in HTML", () => {
    const links = discoverFeedLinks(`<link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel="stylesheet" href="/a.css">`, "https://acme.com/blog");
    expect(links).toEqual(["https://acme.com/feed.xml"]);
  });

  it("parses careers URLs for supported boards", () => {
    expect(parseCareersUrl("https://job-boards.greenhouse.io/acme/jobs/123")).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(parseCareersUrl("https://jobs.lever.co/acme-inc")).toEqual({ provider: "lever", slug: "acme-inc" });
    expect(parseCareersUrl("https://jobs.ashbyhq.com/Acme")).toEqual({ provider: "ashby", slug: "Acme" });
    expect(parseCareersUrl("https://acme.com/careers")).toBeNull();
  });
});
