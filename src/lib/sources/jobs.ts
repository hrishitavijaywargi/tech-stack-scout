import { HttpError, decodeEntities, fetchWithTimeout, mapLimit, stripHtml, withRetry } from "@/lib/http";
import { ENGINEERING_TITLE, detectInText } from "@/lib/research/catalog";
import { loginGuesses, normalizeCompanyName } from "@/lib/sources/github";
import type { EvidenceItem, SourceRef, SourceStatus } from "@/lib/types";

/**
 * Job postings from the public job-board APIs of Greenhouse, Lever and Ashby. These are
 * official, documented JSON endpoints (no HTML scraping). A guessed board is only used when
 * it can be tied to the company (board name or posting text names the company).
 */

type Provider = "greenhouse" | "lever" | "ashby";

interface Posting {
  title: string;
  url: string;
  publishedAt: string | null;
  text: string;
  team: string | null;
}

interface Board {
  provider: Provider;
  slug: string;
  boardUrl: string;
  postings: Posting[];
}

export interface JobsCollection {
  status: SourceStatus;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  postings: { title: string; url: string; publishedAt: string | null }[];
}

export function parseCareersUrl(url: string | null): { provider: Provider; slug: string } | null {
  if (!url) return null;
  const gh = /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i.exec(url);
  if (gh) return { provider: "greenhouse", slug: gh[1] };
  const lever = /jobs\.(?:eu\.)?lever\.co\/([\w.-]+)/i.exec(url);
  if (lever) return { provider: "lever", slug: lever[1] };
  const ashby = /jobs\.ashbyhq\.com\/([\w.%-]+)/i.exec(url);
  if (ashby) return { provider: "ashby", slug: decodeURIComponent(ashby[1]) };
  return null;
}

async function getJson<T>(url: string): Promise<T | null> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": "tech-stack-scout", Accept: "application/json" }, timeoutMs: 10_000 });
      if (res.status === 404 || res.status === 400 || res.status === 403) return null;
      if (!res.ok) throw new HttpError(res.status, url, `Job board API error ${res.status}`);
      return (await res.json()) as T;
    },
    { retries: 1 },
  );
}

async function fetchGreenhouse(slug: string, companyName: string, trusted: boolean): Promise<Board | null> {
  const meta = await getJson<{ name: string }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`);
  if (!meta) return null;
  if (!trusted && normalizeCompanyName(meta.name) !== normalizeCompanyName(companyName)) return null;
  const data = await getJson<{ jobs: { title: string; absolute_url: string; updated_at: string; first_published?: string; content?: string; departments?: { name: string }[] }[] }>(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
  );
  if (!data) return null;
  return {
    provider: "greenhouse",
    slug,
    boardUrl: `https://job-boards.greenhouse.io/${slug}`,
    postings: data.jobs.map((j) => ({
      title: j.title,
      url: j.absolute_url,
      publishedAt: j.first_published ?? j.updated_at ?? null,
      text: stripHtml(decodeEntities(j.content ?? "")),
      team: j.departments?.[0]?.name ?? null,
    })),
  };
}

function mentionsCompany(postings: Posting[], companyName: string) {
  const name = companyName.replace(/[^\w\s&.-]/g, "").trim();
  if (name.length < 3) return false;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return postings.slice(0, 10).some((p) => re.test(p.text));
}

async function fetchLever(slug: string, companyName: string, trusted: boolean): Promise<Board | null> {
  const data = await getJson<
    { text: string; hostedUrl: string; createdAt: number; descriptionPlain?: string; additionalPlain?: string; lists?: { text: string; content: string }[]; categories?: { team?: string } }[]
  >(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json&limit=200`);
  if (!data || !Array.isArray(data) || !data.length) return null;
  const postings: Posting[] = data.map((p) => ({
    title: p.text,
    url: p.hostedUrl,
    publishedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    text: [p.descriptionPlain, ...(p.lists ?? []).map((l) => `${l.text}: ${stripHtml(l.content)}`), p.additionalPlain].filter(Boolean).join(" "),
    team: p.categories?.team ?? null,
  }));
  if (!trusted && !mentionsCompany(postings, companyName)) return null;
  return { provider: "lever", slug, boardUrl: `https://jobs.lever.co/${slug}`, postings };
}

async function fetchAshby(slug: string, companyName: string, trusted: boolean): Promise<Board | null> {
  const data = await getJson<{ jobs: { title: string; jobUrl: string; publishedAt?: string; descriptionPlain?: string; department?: string; team?: string }[] }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
  );
  if (!data?.jobs?.length) return null;
  const postings: Posting[] = data.jobs.map((j) => ({
    title: j.title,
    url: j.jobUrl,
    publishedAt: j.publishedAt ?? null,
    text: j.descriptionPlain ?? "",
    team: j.department ?? j.team ?? null,
  }));
  if (!trusted && !mentionsCompany(postings, companyName)) return null;
  return { provider: "ashby", slug, boardUrl: `https://jobs.ashbyhq.com/${slug}`, postings };
}

const FETCHERS: Record<Provider, typeof fetchGreenhouse> = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby };
const PROVIDER_LABEL: Record<Provider, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

async function findBoard(company: { name: string; domain: string | null; careers_url: string | null }, githubLogin: string | null) {
  const explicit = parseCareersUrl(company.careers_url);
  if (explicit) return FETCHERS[explicit.provider](explicit.slug, company.name, true);

  const slugs = [...new Set([...loginGuesses(company.name, company.domain), ...(githubLogin ? [githubLogin.toLowerCase()] : [])])].slice(0, 4);
  for (const provider of ["greenhouse", "lever", "ashby"] as Provider[]) {
    const results = await mapLimit(slugs, 2, (slug) => FETCHERS[provider](slug, company.name, false).catch(() => null));
    const hit = results.find(Boolean);
    if (hit) return hit;
  }
  return null;
}

export async function collectJobPostings(
  company: { name: string; domain: string | null; careers_url: string | null },
  githubLogin: string | null,
  { maxPostings = 30 }: { maxPostings?: number } = {},
): Promise<JobsCollection> {
  let board: Board | null;
  try {
    board = await findBoard(company, githubLogin);
  } catch (err) {
    return {
      status: { source: "Job postings", status: "error", detail: `Job board lookup failed: ${(err as Error).message}` },
      evidence: [],
      sources: [],
      postings: [],
    };
  }

  if (!board) {
    const hint = company.careers_url
      ? "The careers URL is not a Greenhouse, Lever or Ashby board, so postings could not be read through a public API."
      : "No public Greenhouse, Lever or Ashby job board could be linked to this company. Add a careers URL to improve coverage.";
    return { status: { source: "Job postings", status: "not_found", detail: hint }, evidence: [], sources: [], postings: [] };
  }

  const engineering = board.postings
    .filter((p) => ENGINEERING_TITLE.test(p.title) || (p.team && ENGINEERING_TITLE.test(p.team)))
    .sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"))
    .slice(0, maxPostings);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const p of engineering) {
    const ref: SourceRef = { url: p.url, type: "job_posting", title: p.title, publishedAt: p.publishedAt, metadata: { board: board.provider, team: p.team } };
    const matches = detectInText(`${p.title}. ${p.text}`);
    if (!matches.length) continue;
    sources.push(ref);
    for (const m of matches) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "job_posting", source: ref, evidence: `"${p.title}" posting: "${m.snippet}"` });
    }
  }

  return {
    status: {
      source: "Job postings",
      status: "ok",
      items: engineering.length,
      url: board.boardUrl,
      detail: `${PROVIDER_LABEL[board.provider]} board "${board.slug}": ${board.postings.length} open postings, ${engineering.length} engineering roles analyzed, ${sources.length} mention specific technologies.`,
    },
    evidence,
    sources,
    postings: engineering.map((p) => ({ title: p.title, url: p.url, publishedAt: p.publishedAt })),
  };
}
