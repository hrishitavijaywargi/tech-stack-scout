import Papa from "papaparse";
import { z } from "zod";

/** Pure (client + server) validation and normalisation of company input and CSV files. */

export type JobBoardProvider = "greenhouse" | "lever" | "ashby";

export interface CompanyInput {
  name: string;
  domain: string;
  github_org: string | null;
  job_board_provider: JobBoardProvider | null;
  job_board_slug: string | null;
  blog_rss_url: string | null;
}

export const rawCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200, "Company name is too long"),
  website: z.string().trim().max(300).nullish(),
  github: z.string().trim().max(300).nullish(),
  /** A Greenhouse/Lever/Ashby board URL — parsed into provider + slug. */
  careers_url: z.string().trim().max(500).nullish(),
  job_board_provider: z.string().trim().max(20).nullish(),
  job_board_slug: z.string().trim().max(100).nullish(),
  blog_rss_url: z.string().trim().max(500).nullish(),
});
export type RawCompany = z.infer<typeof rawCompanySchema>;

export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function normalizeDomain(input: string | null | undefined): string | null {
  const v = input?.trim();
  if (!v) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).hostname.toLowerCase();
  } catch {
    throw new Error(`"${v}" is not a valid website`);
  }
  host = host.replace(/^www\./, "");
  if (!DOMAIN_RE.test(host) || !/\.[a-z]{2,}$/.test(host)) throw new Error(`"${v}" is not a valid website`);
  if (host === "github.com") throw new Error("Use the GitHub column for github.com links");
  return host;
}

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function parseGithubOrg(input: string | null | undefined): string | null {
  const v = input?.trim();
  if (!v) return null;
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]+)/i.exec(v);
  const login = (m ? m[1] : v).replace(/^@/, "");
  if (!LOGIN_RE.test(login)) throw new Error(`"${v}" is not a valid GitHub organization or URL`);
  return login;
}

export function normalizeUrl(input: string | null | undefined, label: string): string | null {
  const v = input?.trim();
  if (!v) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw new Error(`"${v}" is not a valid ${label}`);
  }
}

const PROVIDERS: JobBoardProvider[] = ["greenhouse", "lever", "ashby"];
const SLUG_RE = /^[A-Za-z0-9._%-]{1,100}$/;

/** Job board from an explicit provider + slug, or from a Greenhouse/Lever/Ashby careers URL. */
export function parseJobBoard(provider: string | null | undefined, slug: string | null | undefined, careersUrl: string | null | undefined): { provider: JobBoardProvider; slug: string } | null {
  const p = provider?.trim().toLowerCase();
  const sl = slug?.trim();
  if (p || sl) {
    if (!p || !PROVIDERS.includes(p as JobBoardProvider)) throw new Error(`Job board provider must be one of ${PROVIDERS.join(", ")}`);
    if (!sl || !SLUG_RE.test(sl)) throw new Error("Job board slug is missing or invalid");
    return { provider: p as JobBoardProvider, slug: sl };
  }
  const u = careersUrl?.trim();
  if (!u) return null;
  const gh = /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i.exec(u);
  if (gh) return { provider: "greenhouse", slug: gh[1] };
  const lever = /jobs\.(?:eu\.)?lever\.co\/([\w.-]+)/i.exec(u);
  if (lever) return { provider: "lever", slug: lever[1] };
  const ashby = /jobs\.ashbyhq\.com\/([\w.%-]+)/i.exec(u);
  if (ashby) return { provider: "ashby", slug: decodeURIComponent(ashby[1]) };
  throw new Error("Careers URL must be a Greenhouse, Lever or Ashby job board (or set provider + slug)");
}

export function normalizeCompany(raw: unknown): { ok: true; value: CompanyInput } | { ok: false; errors: string[] } {
  const parsed = rawCompanySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  const r = parsed.data;
  const errors: string[] = [];
  const attempt = <T,>(fn: () => T): T | null => {
    try {
      return fn();
    } catch (e) {
      errors.push((e as Error).message);
      return null;
    }
  };
  // A github.com URL pasted into the website column is moved to the GitHub field.
  let website = r.website ?? null;
  let github = r.github ?? null;
  if (website && /github\.com\//i.test(website) && !github) {
    github = website;
    website = null;
  }
  const domain = attempt(() => normalizeDomain(website));
  if (!domain && !errors.length) errors.push("Website / domain is required");
  const board = attempt(() => parseJobBoard(r.job_board_provider, r.job_board_slug, r.careers_url));
  const value: CompanyInput = {
    name: r.name.replace(/\s+/g, " "),
    domain: domain ?? "",
    github_org: attempt(() => parseGithubOrg(github)),
    job_board_provider: board?.provider ?? null,
    job_board_slug: board?.slug ?? null,
    blog_rss_url: attempt(() => normalizeUrl(r.blog_rss_url, "blog RSS URL")),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** Identity keys used to prevent duplicates (name, website domain, GitHub org). */
export function identityKeys(c: Pick<CompanyInput, "name" | "domain" | "github_org">) {
  const keys = [`name:${nameKey(c.name)}`];
  if (c.domain) keys.push(`domain:${c.domain}`);
  if (c.github_org) keys.push(`github:${c.github_org.toLowerCase()}`);
  return keys;
}

export function findDuplicate(c: Pick<CompanyInput, "name" | "domain" | "github_org">, existing: Pick<CompanyInput, "name" | "domain" | "github_org">[]) {
  const mine = new Set(identityKeys(c));
  for (const e of existing) {
    const hit = identityKeys(e).find((k) => mine.has(k));
    if (hit) {
      const [kind] = hit.split(":");
      return { name: e.name, matchedOn: kind === "name" ? "name" : kind === "domain" ? "website" : "GitHub organization" };
    }
  }
  return null;
}

// ------------------------------------------------------------------ CSV import

export const MAX_CSV_ROWS = 200;

const HEADER_ALIASES: Record<keyof RawCompany, string[]> = {
  name: ["name", "company", "company name", "company_name", "account", "account name"],
  website: ["website", "domain", "url", "site", "company website", "homepage"],
  github: ["github", "github org", "github_org", "github url", "github_url", "github organization"],
  careers_url: ["careers", "careers url", "careers_url", "jobs", "jobs url", "job board url"],
  job_board_provider: ["job_board_provider", "job board provider", "ats", "provider"],
  job_board_slug: ["job_board_slug", "job board slug", "slug", "board slug"],
  blog_rss_url: ["blog", "blog url", "blog_url", "engineering blog", "rss", "blog_rss_url", "rss url", "feed"],
};

export interface CsvRow {
  line: number;
  raw: Record<string, string>;
  status: "valid" | "invalid" | "duplicate_in_file";
  value: CompanyInput | null;
  errors: string[];
}

export interface CsvParseResult {
  rows: CsvRow[];
  fileErrors: string[];
  valid: CompanyInput[];
}

export function parseCompanyCsv(text: string): CsvParseResult {
  const fileErrors: string[] = [];
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, " "),
  });
  for (const e of res.errors.slice(0, 5)) fileErrors.push(`Row ${(e.row ?? 0) + 2}: ${e.message}`);

  const headers = res.meta.fields ?? [];
  const col = Object.fromEntries((Object.keys(HEADER_ALIASES) as (keyof RawCompany)[]).map((k) => [k, headers.find((h) => HEADER_ALIASES[k].includes(h))])) as Record<
    keyof RawCompany,
    string | undefined
  >;
  if (!col.name) return { rows: [], valid: [], fileErrors: [`The CSV needs a "name" (or "company") column. Found: ${headers.join(", ") || "no columns"}.`] };
  if (!col.website) fileErrors.push('The CSV needs a "website" (or "domain") column — every company needs a domain.');
  if (res.data.length > MAX_CSV_ROWS) fileErrors.push(`Only the first ${MAX_CSV_ROWS} rows are imported (file has ${res.data.length}).`);

  const seen: CompanyInput[] = [];
  const rows: CsvRow[] = res.data.slice(0, MAX_CSV_ROWS).map((r, i) => {
    const raw = Object.fromEntries((Object.keys(col) as (keyof RawCompany)[]).filter((k) => col[k]).map((k) => [k, r[col[k]!] ?? ""])) as Record<string, string>;
    const n = normalizeCompany(raw);
    const line = i + 2;
    if (!n.ok) return { line, raw, status: "invalid", value: null, errors: n.errors };
    const dup = findDuplicate(n.value, seen);
    if (dup) return { line, raw, status: "duplicate_in_file", value: n.value, errors: [`Same ${dup.matchedOn} as "${dup.name}" earlier in the file`] };
    seen.push(n.value);
    return { line, raw, status: "valid", value: n.value, errors: [] };
  });
  return { rows, fileErrors, valid: seen };
}

// ------------------------------------------------------------------ CSV export

export function toCsv(rows: Record<string, string | number | null | undefined>[]) {
  // Neutralise spreadsheet formula injection in exported cells.
  const safe = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? "")])));
  return Papa.unparse(safe, { quotes: true });
}
