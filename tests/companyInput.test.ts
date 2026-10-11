import { describe, expect, it } from "vitest";
import { findDuplicate, normalizeCompany, normalizeDomain, parseCompanyCsv, parseGithubOrg, toCsv } from "@/lib/companyInput";

describe("normalisation", () => {
  it("normalises websites to bare domains", () => {
    expect(normalizeDomain("https://www.Stripe.com/docs")).toBe("stripe.com");
    expect(normalizeDomain("  ")).toBeNull();
    expect(() => normalizeDomain("not a domain")).toThrow();
  });

  it("parses GitHub org names and URLs", () => {
    expect(parseGithubOrg("https://github.com/vercel/next.js")).toBe("vercel");
    expect(parseGithubOrg("@hashicorp")).toBe("hashicorp");
    expect(() => parseGithubOrg("bad org!")).toThrow();
  });

  it("moves a github.com URL from the website column", () => {
    const r = normalizeCompany({ name: "Acme", website: "https://github.com/acme" });
    expect(r.ok && r.value).toMatchObject({ domain: null, github_org: "acme" });
  });

  it("detects duplicates by name, domain or GitHub org", () => {
    const existing = [{ name: "Acme Corp", domain: "acme.com", github_org: "acme" }];
    expect(findDuplicate({ name: "acme  corp", domain: null, github_org: null, careers_url: null, blog_url: null }, existing)?.matchedOn).toBe("name");
    expect(findDuplicate({ name: "Acme Inc", domain: "acme.com", github_org: null, careers_url: null, blog_url: null }, existing)?.matchedOn).toBe("website");
    expect(findDuplicate({ name: "Other", domain: null, github_org: "ACME", careers_url: null, blog_url: null }, existing)?.matchedOn).toBe("GitHub organization");
    expect(findDuplicate({ name: "Other", domain: "other.com", github_org: null, careers_url: null, blog_url: null }, existing)).toBeNull();
  });
});

describe("CSV import", () => {
  it("accepts 20 companies and flags invalid and duplicate rows", () => {
    const lines = ["Company,Website,GitHub"];
    for (let i = 1; i <= 20; i++) lines.push(`Company ${i},company${i}.com,org${i}`);
    lines.push("Company 3,company3.com,"); // duplicate
    lines.push(",nameless.com,"); // invalid: no name
    lines.push("Broken,not a url,"); // invalid website
    const r = parseCompanyCsv(lines.join("\n"));
    expect(r.valid).toHaveLength(20);
    expect(r.rows.filter((x) => x.status === "duplicate_in_file")).toHaveLength(1);
    expect(r.rows.filter((x) => x.status === "invalid")).toHaveLength(2);
    expect(r.rows.find((x) => x.status === "invalid")?.line).toBe(23);
  });

  it("requires a name column", () => {
    const r = parseCompanyCsv("website,github\nacme.com,acme\n");
    expect(r.fileErrors[0]).toMatch(/name/);
  });

  it("accepts a headerless single-column list", () => {
    const r = parseCompanyCsv("Stripe\nShopify\nAtlassian\n");
    expect(r.valid.map((v) => v.name)).toEqual(["Stripe", "Shopify", "Atlassian"]);
  });
});

describe("CSV export", () => {
  it("escapes spreadsheet formulas", () => {
    const csv = toCsv([{ a: "=HYPERLINK(1)", b: "plain", c: 3 }]);
    expect(csv).toContain(`"'=HYPERLINK(1)"`);
    expect(csv).toContain(`"plain"`);
  });
});
