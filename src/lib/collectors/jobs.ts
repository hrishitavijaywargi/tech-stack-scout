import { z } from "zod";
import { HttpError, decodeEntities, fetchWithTimeout, mapLimit, stripHtml, withRetry } from "@/lib/http";
import { ENGINEERING_TITLE, detectInText } from "@/lib/techDictionary";
import { loginGuesses, normalizeCompanyName } from "@/lib/collectors/github";
import { UA } from "@/lib/collectors/common";
import type { EvidenceItem, Hiring, SourceRef, SourceStatusEntry } from "@/lib/types";

/**
 * Job postings from the public Greenhouse, Lever and Ashby job-board APIs (official JSON, no
 * scraping). A provider/slug stored on the company is used as-is; otherwise boards are
 * auto-discovered from name/domain slugs and only accepted when they can be tied to the
 * company (board name or posting text names it). The discovered board is saved back.
 */

export type Provider = "greenhouse" | "lever" | "ashby";
export const PROVIDER_LABEL: Record<Provider, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

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

const ghJobs = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      absolute_url: z.string(),
      updated_at: z.string().nullable().optional(),
      first_published: z.string().nullable().optional(),
      content: z.string().nullable().optional(),
      departments: z.array(z.object({ name: z.string() })).optional(),
    }),
  ),
});
const leverJobs = z.array(
  z.object({
    text: z.string(),
    hostedUrl: z.string(),
    createdAt: z.number().optional(),
    descriptionPlain: z.string().optional(),
    additionalPlain: z.string().optional(),
    lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
    categories: z.object({ team: z.string().optional(), department: z.string().optional() }).optional(),
  }),
);
const ashbyJobs = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      jobUrl: z.string(),
      publishedAt: z.string().optional(),
      descriptionPlain: z.string().optional(),
      department: z.string().optional(),
      team: z.string().optional(),
    }),
  ),
});

export function parseCareersUrl(url: string | null | undefined): { provider: Provider; slug: string } | null {
  if (!url) return null;
  const gh = /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?([\w-]+)/i.exec(url);
  if (gh) return { provider: "greenhouse", slug: gh[1] };
  const lever = /jobs\.(?:eu\.)?lever\.co\/([\w.-]+)/i.exec(url);
  if (lever) return { provider: "lever", slug: lever[1] };
  const ashby = /jobs\.ashbyhq\.com\/([\w.%-]+)/i.exec(url);
  if (ashby) return { provider: "ashby", slug: decodeURIComponent(ashby[1]) };
  return null;
}

export function boardUrl(provider: Provider, slug: string) {
  return provider === "greenhouse" ? `https://job-boards.greenhouse.io/${slug}` : provider === "lever" ? `https://jobs.lever.co/${slug}` : `https://jobs.ashbyhq.com/${slug}`;
}

async function getJson(url: string): Promise<unknown | null> {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeoutMs: 25_000 });
      if (res.status === 404 || res.status === 400 || res.status === 403) return null;
      if (!res.ok) throw new HttpError(res.status, url, `Job board API error ${res.status}`);
      return res.json();
    },
    { retries: 1 },
  );
}

function mentionsCompany(postings: Posting[], companyName: string) {
  const name = companyName.replace(/[^\w\s&.-]/g, "").trim();
  if (name.length < 3) return false;
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return postings.slice(0, 10).some((p) => re.test(p.text));
}

async function fetchBoard(provider: Provider, slug: string, companyName: string, trusted: boolean): Promise<Board | null> {
  const s = encodeURIComponent(slug);
  if (provider === "greenhouse") {
    if (!trusted) {
      const meta = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}`)) as { name?: string } | null;
      if (!meta?.name || normalizeCompanyName(meta.name) !== normalizeCompanyName(companyName)) return null;
    }
    const data = ghJobs.safeParse(await getJson(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`));
    if (!data.success) return null;
    return {
      provider,
      slug,
      boardUrl: boardUrl(provider, slug),
      postings: data.data.jobs.map((j) => ({
        title: j.title,
        url: j.absolute_url,
        publishedAt: j.first_published ?? j.updated_at ?? null,
        text: stripHtml(decodeEntities(j.content ?? "")),
        team: j.departments?.[0]?.name ?? null,
      })),
    };
  }
  if (provider === "lever") {
    const data = leverJobs.safeParse(await getJson(`https://api.lever.co/v0/postings/${s}?mode=json`));
    if (!data.success || !data.data.length) return null;
    const postings = data.data.map((p) => ({
      title: p.text,
      url: p.hostedUrl,
      publishedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      text: [p.descriptionPlain, ...(p.lists ?? []).map((l) => `${l.text}: ${stripHtml(l.content)}`), p.additionalPlain].filter(Boolean).join(" "),
      team: p.categories?.team ?? p.categories?.department ?? null,
    }));
    if (!trusted && !mentionsCompany(postings, companyName)) return null;
    return { provider, slug, boardUrl: boardUrl(provider, slug), postings };
  }
  const data = ashbyJobs.safeParse(await getJson(`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=false`));
  if (!data.success || !data.data.jobs.length) return null;
  const postings = data.data.jobs.map((j) => ({ title: j.title, url: j.jobUrl, publishedAt: j.publishedAt ?? null, text: j.descriptionPlain ?? "", team: j.department ?? j.team ?? null }));
  if (!trusted && !mentionsCompany(postings, companyName)) return null;
  return { provider, slug, boardUrl: boardUrl(provider, slug), postings };
}

/** Try each provider with slugs derived from the company name/domain (and GitHub login). */
export async function discoverBoard(company: { name: string; domain: string | null }, githubLogin: string | null): Promise<Board | null> {
  const slugs = [...new Set([...loginGuesses(company.name, company.domain), ...(githubLogin ? [githubLogin.toLowerCase()] : [])])].slice(0, 4);
  for (const provider of ["greenhouse", "lever", "ashby"] as Provider[]) {
    const hit = (await mapLimit(slugs, 2, (slug) => fetchBoard(provider, slug, company.name, false).catch(() => null))).find(Boolean);
    if (hit) return hit;
  }
  return null;
}

export function isEngineering(p: { title: string; team: string | null }) {
  return ENGINEERING_TITLE.test(p.title) || Boolean(p.team && ENGINEERING_TITLE.test(p.team));
}

/** Count, per technology, how many engineering postings mention it. Pure — unit tested. */
export function extractTechMentions(postings: { title: string; text: string }[]) {
  const counts = new Map<string, { tech: string; count: number; category: Hiring["tech_mentions"][number]["category"] }>();
  const perPosting = postings.map((p) => {
    const matches = detectInText(`${p.title}. ${p.text}`);
    for (const m of matches) {
      const cur = counts.get(m.def.name) ?? { tech: m.def.name, count: 0, category: m.def.category };
      cur.count++;
      counts.set(m.def.name, cur);
    }
    return matches;
  });
  const mentions = [...counts.values()].sort((a, b) => b.count - a.count || a.tech.localeCompare(b.tech));
  return { mentions, perPosting };
}

export interface JobsCollection {
  hiring: Hiring;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  discovered: { provider: Provider; slug: string } | null;
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export function emptyHiring(): Hiring {
  return { provider: null, slug: null, board_url: null, total_open_roles: 0, eng_open_roles: 0, previous_eng_open_roles: null, tech_mentions: [], sample_roles: [] };
}

export async function collectJobs(
  company: { name: string; domain: string | null; job_board_provider: Provider | null; job_board_slug: string | null },
  githubLogin: string | null,
): Promise<JobsCollection> {
  const stored = company.job_board_provider && company.job_board_slug ? { provider: company.job_board_provider, slug: company.job_board_slug } : null;
  const board = stored ? await fetchBoard(stored.provider, stored.slug, company.name, true) : await discoverBoard(company, githubLogin);

  if (!board) {
    return {
      hiring: emptyHiring(),
      evidence: [],
      sources: [],
      discovered: null,
      status: {
        status: stored ? "error" : "not_found",
        message: stored
          ? `The saved job board ${PROVIDER_LABEL[stored.provider]}/${stored.slug} returned no postings.`
          : "No public Greenhouse, Lever or Ashby job board could be linked to this company. Set job_board_provider/slug to add one.",
      },
    };
  }

  const engineering = board.postings.filter(isEngineering).slice(0, 300);
  const { mentions, perPosting } = extractTechMentions(engineering);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  const perTechEvidence = new Map<string, number>();
  engineering.forEach((p, i) => {
    const matches = perPosting[i];
    if (!matches.length) return;
    const ref: SourceRef = { url: p.url, type: "job_posting", title: p.title, publishedAt: p.publishedAt, metadata: { board: board.provider, team: p.team } };
    let used = false;
    for (const m of matches) {
      // Keep at most 3 example postings per technology as stored evidence; counts cover all postings.
      const n = perTechEvidence.get(m.def.name) ?? 0;
      if (n >= 3) continue;
      perTechEvidence.set(m.def.name, n + 1);
      used = true;
      const total = mentions.find((x) => x.tech === m.def.name)?.count ?? 1;
      evidence.push({
        technology: m.def.name,
        category: m.def.category,
        kind: "job_posting",
        source: ref,
        evidence: `"${p.title}" posting: "${m.snippet}"`,
        detail: { postingsMentioning: total, engPostings: engineering.length },
      });
    }
    if (used) sources.push(ref);
  });

  // Most relevant roles: the most technology-specific postings, newest first on ties.
  const sample = engineering
    .map((p, i) => ({ p, techs: perPosting[i].map((m) => m.def.name) }))
    .sort((a, b) => b.techs.length - a.techs.length || Date.parse(b.p.publishedAt ?? "0") - Date.parse(a.p.publishedAt ?? "0"))
    .slice(0, 5)
    .map(({ p, techs }) => ({ title: p.title, url: p.url, team: p.team, techs: techs.slice(0, 8) }));

  return {
    hiring: {
      provider: board.provider,
      slug: board.slug,
      board_url: board.boardUrl,
      total_open_roles: board.postings.length,
      eng_open_roles: engineering.length,
      previous_eng_open_roles: null,
      tech_mentions: mentions.slice(0, 40),
      sample_roles: sample,
    },
    evidence,
    sources,
    discovered: stored ? null : { provider: board.provider, slug: board.slug },
    status: {
      status: "ok",
      items: engineering.length,
      url: board.boardUrl,
      message: `${PROVIDER_LABEL[board.provider]} board "${board.slug}"${stored ? "" : " (auto-discovered)"}: ${board.postings.length} open roles, ${engineering.length} engineering; ${mentions.length} technologies mentioned.`,
    },
  };
}
