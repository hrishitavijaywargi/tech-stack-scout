import { z } from "zod";
import { HttpError, fetchWithTimeout, hostMatchesDomain, hostOf, withRetry } from "@/lib/http";
import { detectInText } from "@/lib/techDictionary";
import { DAY, UA } from "@/lib/collectors/common";
import type { EvidenceItem, HnStory, SourceRef, SourceStatusEntry } from "@/lib/types";

/** Hacker News via the official Algolia API: engineering stories about the company in the last year. */

const hitSchema = z.object({
  title: z.string().nullable(),
  url: z.string().nullable().optional(),
  points: z.number().nullable().optional(),
  created_at: z.string(),
  objectID: z.string(),
});
const searchSchema = z.object({ hits: z.array(hitSchema) });

export const ENGINEERING_KEYWORDS =
  /\b(engineering|engineers?|migrat\w*|rewr(i|o)te|re-?architect\w*|scal(e|ing)|outage|post-?mortem|incident|infra\w*|open[- ]sourc\w*|kubernetes|k8s|rust|golang|\bgo\b|typescript|python|java|database|postgres|kafka|latency|performance|compiler|monorepo|microservices?|ci\b|build system|deploy\w*|architecture)\b/i;

/** Keep stories on the company's domain, or naming the company with an engineering keyword. Pure. */
export function relevantStories(hits: z.infer<typeof hitSchema>[], company: { name: string; domain: string }): HnStory[] {
  const nameRe = new RegExp(`\\b${company.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const seen = new Set<string>();
  return hits
    .filter((h) => h.title)
    .filter((h) => hostMatchesDomain(hostOf(h.url ?? null), company.domain) || (nameRe.test(h.title!) && ENGINEERING_KEYWORDS.test(h.title!)))
    .map((h) => ({ title: h.title!, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, points: h.points ?? 0, date: h.created_at, hn_url: `https://news.ycombinator.com/item?id=${h.objectID}` }))
    .filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)))
    .sort((a, b) => b.points - a.points)
    .slice(0, 5);
}

async function search(params: string) {
  const url = `https://hn.algolia.com/api/v1/search?${params}`;
  const res = await withRetry(async () => {
    const r = await fetchWithTimeout(url, { headers: { "User-Agent": UA }, timeoutMs: 10_000 });
    if (!r.ok) throw new HttpError(r.status, url, `Hacker News API error ${r.status}`);
    return r;
  });
  const parsed = searchSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.hits : [];
}

export interface HnCollection {
  stories: HnStory[];
  evidence: EvidenceItem[];
  sources: SourceRef[];
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export async function collectHn(company: { name: string; domain: string }, now = Date.now()): Promise<HnCollection> {
  const since = Math.floor((now - 365 * DAY) / 1000);
  const [byName, byDomain] = await Promise.all([
    search(`query=${encodeURIComponent(company.name)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=50`),
    search(`query=${encodeURIComponent(company.domain)}&restrictSearchableAttributes=url&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=50`),
  ]);
  const stories = relevantStories([...byDomain, ...byName], company);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const s of stories) {
    const ref: SourceRef = { url: s.url, type: "hacker_news", title: s.title, publishedAt: s.date, metadata: { points: s.points, hn: s.hn_url } };
    sources.push(ref);
    for (const m of detectInText(s.title)) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "article", source: ref, evidence: `Hacker News story "${s.title}" (${s.points} points)` });
    }
  }
  return {
    stories,
    evidence,
    sources,
    status: stories.length
      ? { status: "ok", items: stories.length, message: `${stories.length} engineering stories in the last 12 months (top: ${stories[0].points} points).` }
      : { status: "not_found", message: "No engineering-related Hacker News stories about this company in the last 12 months." },
  };
}
