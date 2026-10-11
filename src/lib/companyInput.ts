import Papa from "papaparse";
import { z } from "zod";

/** Pure (client + server) validation and normalisation of company input and CSV files. */

export interface CompanyInput {
  name: string;
  domain: string | null;
  github_org: string | null;
  careers_url: string | null;
  blog_url: string | null;
}

export const rawCompanySchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(200, "Company name is too long"),
  website: z.string().trim().max(300).nullish(),
  github: z.string().trim().max(300).nullish(),
  careers_url: z.string().trim().max(500).nullish(),
  blog_url: z.string().trim().max(500).nullish(),
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
  const value: CompanyInput = {
    name: r.name.replace(/\s+/g, " "),
    domain: attempt(() => normalizeDomain(website)),
    github_org: attempt(() => parseGithubOrg(github)),
    careers_url: attempt(() => normalizeUrl(r.careers_url, "careers URL")),
    blog_url: attempt(() => normalizeUrl(r.blog_url, "blog URL")),
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

export function findDuplicate(c: CompanyInput, existing: Pick<CompanyInput, "name" | "domain" | "github_org">[]) {
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
  careers_url: ["careers", "careers url", "careers_url", "jobs", "jobs url", "job board"],
  blog_url: ["blog", "blog url", "blog_url", "engineering blog"],
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
  const col = Object.fromEntries(
    (Object.keys(HEADER_ALIASES) as (keyof RawCompany)[]).map((k) => [k, headers.find((h) => HEADER_ALIASES[k].includes(h))]),
  ) as Record<keyof RawCompany, string | undefined>;
  if (!col.name) {
    // Headerless single-column file: treat every line as a company name.
    if (headers.length === 1 && !/name|company/.test(headers[0])) {
      return parseCompanyCsv(`name\n${text}`);
    }
    return { rows: [], valid: [], fileErrors: [`The CSV needs a "name" (or "company") column. Found: ${headers.join(", ") || "no columns"}.`] };
  }
  if (res.data.length > MAX_CSV_ROWS) fileErrors.push(`Only the first ${MAX_CSV_ROWS} rows are imported (file has ${res.data.length}).`);

  const seen: CompanyInput[] = [];
  const rows: CsvRow[] = res.data.slice(0, MAX_CSV_ROWS).map((r, i) => {
    const raw = {
      name: r[col.name!] ?? "",
      website: col.website ? r[col.website] : undefined,
      github: col.github ? r[col.github] : undefined,
      careers_url: col.careers_url ? r[col.careers_url] : undefined,
      blog_url: col.blog_url ? r[col.blog_url] : undefined,
    };
    const n = normalizeCompany(raw);
    const line = i + 2;
    const rawOut = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)) as Record<string, string>;
    if (!n.ok) return { line, raw: rawOut, status: "invalid", value: null, errors: n.errors };
    const dup = findDuplicate(n.value, seen);
    if (dup) return { line, raw: rawOut, status: "duplicate_in_file", value: n.value, errors: [`Same ${dup.matchedOn} as "${dup.name}" earlier in the file`] };
    seen.push(n.value);
    return { line, raw: rawOut, status: "valid", value: n.value, errors: [] };
  });

  return { rows, fileErrors, valid: seen };
}

// ------------------------------------------------------------------ CSV export

export function toCsv(rows: Record<string, string | number | null | undefined>[]) {
  // Neutralise spreadsheet formula injection in exported cells.
  const safe = rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v ?? ""])),
  );
  return Papa.unparse(safe, { quotes: true });
}
