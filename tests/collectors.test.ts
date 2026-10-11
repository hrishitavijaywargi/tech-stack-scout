import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubClient, aggregateLanguages, brandLabel, collectGithub, identifyGithubOrg, normalizeCompanyName, profileMatchesBrand, type GhProfile } from "@/lib/collectors/github";
import { extractTechMentions, isEngineering, parseCareersUrl } from "@/lib/collectors/jobs";
import { HOSTING_PATTERNS, MX_PATTERNS, firstMatch, parseTxt } from "@/lib/collectors/dns";
import { analyzeSubdomains } from "@/lib/collectors/crtsh";
import { relevantStories } from "@/lib/collectors/hn";
import { discoverFeedLinks, isTechnicalPost } from "@/lib/collectors/rss";
import { RateLimitError } from "@/lib/http";

function mockFetch(routes: [RegExp, (url: string) => Response][]) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    for (const [re, fn] of routes) if (re.test(url)) return fn(url);
    return new Response("not found", { status: 404 });
  });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

const NOW = Date.parse("2026-10-11T00:00:00Z");
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const org = (login: string, name: string, blog: string, repos: number) => ({ login, type: "Organization", name, blog, email: null, html_url: `https://github.com/${login}`, public_repos: repos });

describe("GitHub identification", () => {
  it("verifies an org whose profile links to the company website", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [{ login: "acme-corp" }] })],
      [/\/users\/acme-corp$/, () => json(org("acme-corp", "Acme", "https://www.acme.io", 12))],
      [/\/users\/acme$/, () => json(org("acme", "ACME Games", "https://acme.games", 50))],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Acme", domain: "acme.io", github_org: null });
    expect(ident).toMatchObject({ method: "verified_domain", login: "acme-corp" });
  });

  it("prefers a name-matching org on the same brand (Shopify → shopify.engineering) over a side account", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [{ login: "Shopify-Partners" }, { login: "Shopify" }] })],
      [/\/users\/Shopify-Partners$/, () => json(org("Shopify-Partners", "Shopify Partners", "https://shopify.com", 2))],
      [/\/users\/(S|s)hopify$/, () => json(org("Shopify", "Shopify", "https://shopify.engineering/", 1500))],
    ]);
    const { ident } = await identifyGithubOrg(new GitHubClient(), { name: "Shopify", domain: "shopify.com", github_org: null });
    expect(ident.login).toBe("Shopify");
  });

  it("marks a name-only match as unconfirmed and raises RateLimitError when exhausted", async () => {
    mockFetch([
      [/search\/users/, () => json({ items: [] })],
      [/\/users\/acme$/, () => json(org("acme", "Acme", "", 5))],
    ]);
    expect((await identifyGithubOrg(new GitHubClient(), { name: "Acme Inc.", domain: "acme.com", github_org: null })).ident.method).toBe("name_match_unconfirmed");
    mockFetch([[/api\.github\.com/, () => new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(NOW / 1000 + 600) } })]]);
    await expect(identifyGithubOrg(new GitHubClient(), { name: "Acme", domain: null, github_org: "acme" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("helpers", () => {
    expect(normalizeCompanyName("Acme Technologies, Inc.")).toBe("acme");
    expect(brandLabel("engineering.shopify.com")).toBe("shopify");
    expect(profileMatchesBrand({ blog: "https://airbnb.tech" }, "airbnb.com")).toBe(true);
  });
});

describe("GitHub collection (REST path, mocked API)", () => {
  it("collects languages, recent languages, code evidence, 52-week commits, contributors and releases", async () => {
    const repo = (name: string, pushed: number, extra = {}) => ({
      name,
      full_name: `acme/${name}`,
      html_url: `https://github.com/acme/${name}`,
      description: null,
      fork: false,
      archived: false,
      size: 100,
      stargazers_count: 10,
      pushed_at: day(pushed),
      created_at: day(400),
      default_branch: "main",
      ...extra,
    });
    mockFetch([
      [/\/orgs\/acme\/repos/, () => json([repo("api", 2), repo("web", 5), repo("old", 500), repo("new-svc", 1, { created_at: day(10) })])],
      [/\/repos\/acme\/api\/languages/, () => json({ Go: 9000 })],
      [/\/repos\/acme\/old\/languages/, () => json({ Ruby: 20000 })],
      [/\/repos\/acme\/web\/languages/, () => json({ TypeScript: 3000 })],
      [/\/languages$/, () => json({})],
      [/\/repos\/acme\/api\/git\/trees/, () => json({ truncated: false, tree: ["Dockerfile", "deploy/main.tf", "go.mod", "api.proto", "k8s/deploy.yaml"].map((path) => ({ path, type: "blob" })) })],
      [/\/git\/trees/, () => json({ truncated: false, tree: [] })],
      [/raw\.githubusercontent\.com\/acme\/api\/main\/go\.mod/, () => new Response("module acme\nrequire github.com/aws/aws-sdk-go-v2 v1.24.0\n")],
      [/raw\.githubusercontent\.com\/acme\/api\/main\/deploy\/main\.tf/, () => new Response('provider "aws" { region = "us-east-1" }')],
      [/\/repos\/acme\/api\/releases/, () => json([{ tag_name: "v1.2.0", name: "v1.2.0", html_url: "https://github.com/acme/api/releases/v1.2.0", published_at: day(3), draft: false }])],
      [/\/releases/, () => json([])],
      [/\/repos\/acme\/api\/stats\/commit_activity/, () => json(Array.from({ length: 52 }, (_, i) => ({ total: i >= 39 ? 10 : 1, week: i })))],
      [/\/stats\/commit_activity/, () => new Response(null, { status: 204 })],
      [/\/repos\/acme\/api\/contributors/, () => json([{ login: "a", type: "User" }, { login: "b", type: "User" }, { login: "dependabot[bot]", type: "Bot" }])],
      [/\/contributors/, () => json([{ login: "a", type: "User" }])],
    ]);
    const profile: GhProfile = { login: "acme", type: "Organization", name: "Acme", blog: null, email: null, html_url: "https://github.com/acme", public_repos: 4 };
    const col = await collectGithub(new GitHubClient(), profile, { maxRepos: 5, now: NOW });

    expect(col.languages[0].name).toBe("Ruby"); // all-time includes the old Ruby repo
    expect(col.recentLanguages.map((l) => l.name)).not.toContain("Ruby"); // …not pushed in 180 days
    const techs = new Set(col.evidence.map((e) => e.technology));
    for (const t of ["Docker", "Terraform", "AWS", "Kubernetes", "gRPC", "Go"]) expect(techs).toContain(t);
    expect(col.activity.commits_52w).toHaveLength(52);
    expect(col.activity.commits_90d).toBe(130);
    expect(col.activity.contributors).toBe(2); // bots excluded, deduplicated
    expect(col.activity.releases_90d).toBe(1);
    expect(col.activity.new_repos_90d.map((r) => r.name)).toEqual(["acme/new-svc"]);
  });

  it("caps a single vendored codebase so it can't dominate the language mix", () => {
    const repo = (langs: [string, number][]) => ({ languages: langs.map(([name, size]) => ({ name, size, color: null })) }) as never;
    const l = aggregateLanguages([
      repo([["C", 140_000_000]]), // vendored Postgres
      repo([["Python", 1_200_000]]),
      repo([["Python", 1_200_000]]),
      repo([["Python", 1_200_000]]),
      repo([["TypeScript", 1_000_000]]),
      repo([["TypeScript", 900_000]]),
      repo([["Rust", 800_000]]),
    ]);
    expect(l[0].name).toBe("Python");
    expect(l.find((x) => x.name === "C")!.pct).toBeLessThan(40);
    expect(l.find((x) => x.name === "C")!.bytes).toBe(140_000_000); // raw bytes still reported
  });

  it("aggregates language percentages", () => {
    const l = aggregateLanguages([
      { languages: [{ name: "Go", size: 75, color: null }] },
      { languages: [{ name: "TypeScript", size: 25, color: null }] },
    ] as never);
    expect(l.map((x) => [x.name, x.pct])).toEqual([
      ["Go", 75],
      ["TypeScript", 25],
    ]);
  });
});

describe("job postings", () => {
  it("classifies engineering roles", () => {
    expect(isEngineering({ title: "Senior Backend Engineer", team: null })).toBe(true);
    expect(isEngineering({ title: "Account Executive", team: "Sales" })).toBe(false);
  });

  it("counts how many postings mention each technology (aliases included)", () => {
    const { mentions } = extractTechMentions([
      { title: "Platform Engineer", text: "Golang services on k8s, Terraform on AWS" },
      { title: "Backend Engineer", text: "Go and Python, deployed with Kubernetes on AWS" },
      { title: "Data Engineer", text: "Kafka, Airflow and Snowflake" },
    ]);
    const count = (t: string) => mentions.find((m) => m.tech === t)?.count;
    expect(count("Go")).toBe(2);
    expect(count("Kubernetes")).toBe(2);
    expect(count("AWS")).toBe(2);
    expect(count("Kafka")).toBe(1);
    expect(mentions[0].count).toBeGreaterThanOrEqual(mentions.at(-1)!.count);
  });

  it("parses careers URLs", () => {
    expect(parseCareersUrl("https://job-boards.greenhouse.io/acme/jobs/1")).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(parseCareersUrl("https://jobs.lever.co/acme-inc")).toEqual({ provider: "lever", slug: "acme-inc" });
    expect(parseCareersUrl("https://acme.com/careers")).toBeNull();
  });
});

describe("DNS mapping", () => {
  it("maps CNAME / NS hosts to hosting providers", () => {
    const p = (v: string) => firstMatch(HOSTING_PATTERNS, v)?.provider;
    expect(p("d1234.cloudfront.net.")).toBe("AWS");
    expect(p("ghs.googlehosted.com.")).toBe("Google Cloud");
    expect(p("acme.azurewebsites.net.")).toBe("Microsoft Azure");
    expect(p("cname.vercel-dns.com.")).toBe("Vercel");
    expect(p("acme.netlify.app.")).toBe("Netlify");
    expect(p("acme.herokudns.com.")).toBe("Heroku");
    expect(p("dualstack.f2.shared.global.fastly.net.")).toBe("Fastly");
    expect(p("www.acme.com.edgekey.net.")).toBe("Akamai");
    expect(p("kip.ns.cloudflare.com.")).toBe("Cloudflare");
    expect(p("ns-1882.awsdns-43.co.uk")).toBe("AWS");
    expect(p("example.org.")).toBeUndefined();
  });

  it("maps MX hosts to email providers", () => {
    expect(firstMatch(MX_PATTERNS, "aspmx.l.google.com")?.provider).toBe("Google Workspace");
    expect(firstMatch(MX_PATTERNS, "acme-com.mail.protection.outlook.com")?.provider).toBe("Microsoft 365");
  });

  it("parses TXT verification records and SPF includes", () => {
    const { verifications, spf } = parseTxt([
      '"atlassian-domain-verification=abc123"',
      '"docker-verification=1f2e"',
      '"stripe-verification=xyz"',
      '"MS=ms12345678"',
      '"google-site-verification=abc"',
      '"v=spf1 include:_spf.google.com include:sendgrid.net include:custom.example.com ~all"',
      '"some random text"',
    ]);
    expect(verifications.map((v) => v.service)).toEqual(["Atlassian", "Docker Hub", "Stripe", "Microsoft 365", "Google"]);
    expect(spf.map((s) => s.service)).toEqual(["Google Workspace", "SendGrid", null]);
  });
});

describe("certificate transparency", () => {
  it("deduplicates subdomains, drops wildcards and flags tooling", () => {
    const r = analyzeSubdomains(
      [
        { name_value: "grafana.acme.com\n*.acme.com" },
        { name_value: "grafana.acme.com" },
        { name_value: "jenkins.ci.acme.com\nwww.acme.com" },
        { name_value: "argocd.acme.com" },
        { name_value: "acme.com" },
        { name_value: "evil.com" },
      ],
      "acme.com",
    );
    expect(r.count).toBe(4);
    expect(r.tooling.map((t) => t.tool)).toEqual(["Argo CD", "Grafana", "Jenkins"]);
  });
});

describe("Hacker News + RSS", () => {
  it("keeps stories on the company domain or naming it with an engineering keyword", () => {
    const hit = (title: string, url: string | null, points: number) => ({ title, url, points, created_at: "2026-09-01T00:00:00Z", objectID: String(points) });
    const s = relevantStories(
      [hit("How we migrated to Rust", "https://acme.com/blog/rust", 300), hit("Acme raises money", "https://news.example/a", 500), hit("Acme open-sources its build system", "https://github.com/acme/x", 120), hit("Unrelated", "https://x.y", 900)],
      { name: "Acme", domain: "acme.com" },
    );
    expect(s.map((x) => x.points)).toEqual([300, 120]);
  });

  it("discovers feeds and flags technical posts", () => {
    expect(discoverFeedLinks(`<link rel="alternate" type="application/rss+xml" href="/feed.xml">`, "https://acme.com/blog")).toEqual(["https://acme.com/feed.xml"]);
    expect(isTechnicalPost("Scaling Postgres to 10x", "")).toBe(true);
    expect(isTechnicalPost("Our new office in Lisbon", "")).toBe(false);
  });
});
