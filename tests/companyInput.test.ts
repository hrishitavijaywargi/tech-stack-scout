import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeCompany, normalizeDomain, parseCompanyCsv, parseGithubOrg, parseJobBoard, toCsv } from "@/lib/companyInput";

describe("normalisation", () => {
  it("normalises websites to bare domains", () => {
    expect(normalizeDomain("https://www.Stripe.com/docs")).toBe("stripe.com");
    expect(normalizeDomain("  ")).toBeNull();
    expect(() => normalizeDomain("not a domain")).toThrow();
  });

  it("parses GitHub orgs and job boards", () => {
    expect(parseGithubOrg("https://github.com/vercel/next.js")).toBe("vercel");
    expect(() => parseGithubOrg("bad org!")).toThrow();
    expect(parseJobBoard("greenhouse", "stripe", null)).toEqual({ provider: "greenhouse", slug: "stripe" });
    expect(parseJobBoard(null, null, "https://jobs.ashbyhq.com/Acme")).toEqual({ provider: "ashby", slug: "Acme" });
    expect(() => parseJobBoard("workday", "x", null)).toThrow();
    expect(() => parseJobBoard(null, null, "https://acme.com/careers")).toThrow();
  });

  it("requires a domain", () => {
    const r = normalizeCompany({ name: "Acme" });
    expect(r.ok).toBe(false);
  });

  it("moves a github.com URL from the website column (domain still required)", () => {
    const r = normalizeCompany({ name: "Acme", website: "https://github.com/acme" });
    expect(r.ok).toBe(false);
    const ok = normalizeCompany({ name: "Acme", website: "acme.com", github: "https://github.com/acme", job_board_provider: "lever", job_board_slug: "acme" });
    expect(ok.ok && ok.value).toMatchObject({ domain: "acme.com", github_org: "acme", job_board_provider: "lever", job_board_slug: "acme" });
  });

  it("detects duplicates by name, domain or GitHub org", () => {
    const existing = [{ name: "Acme Corp", domain: "acme.com", github_org: "acme" }];
    expect(findDuplicate({ name: "acme  corp", domain: "x.com", github_org: null }, existing)?.matchedOn).toBe("name");
    expect(findDuplicate({ name: "Acme Inc", domain: "acme.com", github_org: null }, existing)?.matchedOn).toBe("website");
    expect(findDuplicate({ name: "Other", domain: "o.com", github_org: "ACME" }, existing)?.matchedOn).toBe("GitHub organization");
    expect(findDuplicate({ name: "Other", domain: "other.com", github_org: null }, existing)).toBeNull();
  });
});

describe("CSV import", () => {
  it("accepts 20 companies and flags invalid and duplicate rows", () => {
    const lines = ["Company,Website,GitHub,job_board_provider,job_board_slug"];
    for (let i = 1; i <= 20; i++) lines.push(`Company ${i},company${i}.com,org${i},greenhouse,c${i}`);
    lines.push("Company 3,company3.com,,,"); // duplicate
    lines.push(",nameless.com,,,"); // no name
    lines.push("Broken,not a url,,,"); // invalid website
    lines.push("NoDomain,,,,"); // domain required
    const r = parseCompanyCsv(lines.join("\n"));
    expect(r.valid).toHaveLength(20);
    expect(r.valid[0]).toMatchObject({ job_board_provider: "greenhouse", job_board_slug: "c1" });
    expect(r.rows.filter((x) => x.status === "duplicate_in_file")).toHaveLength(1);
    expect(r.rows.filter((x) => x.status === "invalid")).toHaveLength(3);
  });

  it("requires a name column", () => {
    expect(parseCompanyCsv("website,github\nacme.com,acme\n").fileErrors[0]).toMatch(/name/);
  });

  it("reads the sample 20-company file format", () => {
    const r = parseCompanyCsv("name,website,github,careers_url,blog_url\nStripe,stripe.com,,,\nCloudflare,cloudflare.com,,,https://blog.cloudflare.com/rss/\n");
    expect(r.valid.map((v) => v.name)).toEqual(["Stripe", "Cloudflare"]);
    expect(r.valid[1].blog_rss_url).toBe("https://blog.cloudflare.com/rss/");
  });
});

describe("CSV export", () => {
  it("escapes spreadsheet formulas", () => {
    const csv = toCsv([{ a: "=HYPERLINK(1)", b: "plain", c: 3 }]);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain(`"plain"`);
  });
});
