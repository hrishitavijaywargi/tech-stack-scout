import { XMLParser } from "fast-xml-parser";
import { HttpError, fetchWithTimeout, hostMatchesDomain, hostOf, stripHtml, withRetry } from "@/lib/http";
import { detectInText } from "@/lib/research/catalog";
import type { EvidenceItem, SourceRef, SourceStatus } from "@/lib/types";

/**
 * Engineering articles from two structured sources:
 *  1. The company's own RSS/Atom feed (auto-discovered from <link rel="alternate"> or a
 *     user-supplied blog URL). Feeds are a stable, standard format — no page scraping.
 *  2. Hacker News (official Algolia API): stories that link to the company's domain.
 */

export interface Article {
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
}

export interface ArticleCollection {
  status: SourceStatus;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  articles: Article[];
}

const DAY = 86_400_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return String((v as Record<string, unknown>)["#text"]);
  return "";
};

/** Parse RSS 2.0 or Atom into articles. Returns null when the document is not a feed. */
export function parseFeed(xml: string): { title: string; articles: Article[] } | null {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch {
    return null;
  }
  if (doc.rss?.channel) {
    const ch = doc.rss.channel;
    return {
      title: text(ch.title),
      articles: asArray<any>(ch.item).map((it) => ({
        title: stripHtml(text(it.title)),
        url: text(it.link) || text(it.guid),
        publishedAt: toIso(text(it.pubDate) || text(it["dc:date"])),
        summary: stripHtml(text(it["content:encoded"]) || text(it.description)).slice(0, 4000),
      })),
    };
  }
  if (doc.feed) {
    const f = doc.feed;
    return {
      title: text(f.title),
      articles: asArray<any>(f.entry).map((e) => {
        const links = asArray<any>(e.link);
        const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
        return {
          title: stripHtml(text(e.title)),
          url: alt?.["@_href"] ?? "",
          publishedAt: toIso(text(e.published) || text(e.updated)),
          summary: stripHtml(text(e.content) || text(e.summary)).slice(0, 4000),
        };
      }),
    };
  }
  return null;
}

function toIso(s: string) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Find RSS/Atom <link rel="alternate"> hrefs in an HTML page. */
export function discoverFeedLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      out.push(new URL(href, pageUrl).toString());
    } catch {
      /* ignore malformed */
    }
  }
  return [...new Set(out)];
}

async function fetchText(url: string, blocked?: number[]) {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": "tech-stack-scout (+feed discovery)", Accept: "application/rss+xml, application/atom+xml, text/html;q=0.8, */*;q=0.5" },
        timeoutMs: 8_000,
        redirect: "follow",
      });
      if (res.status >= 500) throw new HttpError(res.status, url, `HTTP ${res.status}`);
      if (res.status === 403 || res.status === 429) blocked?.push(res.status);
      if (!res.ok) return null;
      const body = await res.text();
      return { body: body.slice(0, 1_500_000), finalUrl: res.url || url };
    },
    { retries: 1 },
  ).catch(() => null);
}

function looksLikeFeed(body: string) {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed)\b/i.test(body);
}

export async function collectBlog(company: { domain: string | null; blog_url: string | null }, { maxFeeds = 2, now = Date.now() } = {}): Promise<ArticleCollection> {
  const pages = company.blog_url
    ? [company.blog_url]
    : company.domain
      ? [`https://engineering.${company.domain}`, `https://${company.domain}/engineering`, `https://${company.domain}/blog`, `https://blog.${company.domain}`, `https://${company.domain}`]
      : [];
  if (!pages.length) {
    return { status: { source: "Engineering blog", status: "skipped", detail: "No website or blog URL on file, so no feed could be discovered." }, evidence: [], sources: [], articles: [] };
  }

  const feeds: { url: string; title: string; articles: Article[] }[] = [];
  const tried = new Set<string>();
  const blocked: number[] = [];
  for (const page of pages) {
    if (feeds.length >= maxFeeds) break;
    const res = await fetchText(page, blocked);
    if (!res) continue;
    const candidates = looksLikeFeed(res.body) ? [{ url: res.finalUrl, body: res.body }] : [];
    if (!candidates.length) {
      for (const link of discoverFeedLinks(res.body, res.finalUrl).slice(0, 2)) {
        if (tried.has(link)) continue;
        tried.add(link);
        const f = await fetchText(link);
        if (f && looksLikeFeed(f.body)) candidates.push({ url: link, body: f.body });
      }
    }
    for (const c of candidates) {
      if (feeds.some((f) => f.url === c.url)) continue;
      const parsed = parseFeed(c.body);
      if (parsed?.articles.length) feeds.push({ url: c.url, title: parsed.title, articles: parsed.articles });
    }
  }

  if (!feeds.length) {
    return {
      status: {
        source: "Engineering blog",
        status: "not_found",
        detail: [
          company.blog_url ? "No RSS/Atom feed was found at the blog URL provided." : `No RSS/Atom feed was discovered on ${company.domain}.`,
          blocked.length ? `The website refused automated requests (HTTP ${[...new Set(blocked)].join("/")}).` : "",
          company.blog_url ? "" : "Add the engineering blog's feed URL to improve coverage.",
        ]
          .filter(Boolean)
          .join(" "),
      },
      evidence: [],
      sources: [],
      articles: [],
    };
  }

  const seen = new Set<string>();
  const articles = feeds
    .flatMap((f) => f.articles)
    .filter((a) => a.url && !seen.has(a.url) && seen.add(a.url))
    .filter((a) => !a.publishedAt || Date.parse(a.publishedAt) >= now - 730 * DAY)
    .sort((a, b) => Date.parse(b.publishedAt ?? "0") - Date.parse(a.publishedAt ?? "0"))
    .slice(0, 25);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const a of articles) {
    const ref: SourceRef = { url: a.url, type: "engineering_blog", title: a.title, publishedAt: a.publishedAt };
    sources.push(ref);
    for (const m of detectInText(`${a.title}. ${a.summary}`)) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "article", source: ref, evidence: `Article "${a.title}": "${m.snippet}"` });
    }
  }

  return {
    status: {
      source: "Engineering blog",
      status: "ok",
      items: articles.length,
      url: feeds[0].url,
      detail: `${feeds.map((f) => f.title || f.url).join(" + ")}: ${articles.length} posts from the last 2 years analyzed.`,
    },
    evidence,
    sources,
    articles,
  };
}

export async function collectHackerNews(company: { domain: string | null }, { now = Date.now() } = {}): Promise<ArticleCollection> {
  if (!company.domain) {
    return { status: { source: "Hacker News", status: "skipped", detail: "Needs the company website to find articles published on its domain." }, evidence: [], sources: [], articles: [] };
  }
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(company.domain)}&restrictSearchableAttributes=url&tags=story&hitsPerPage=60`;
  let data: { hits: { title: string; url: string | null; created_at: string; objectID: string; points: number | null }[] } | null = null;
  try {
    const res = await withRetry(async () => {
      const r = await fetchWithTimeout(url, { timeoutMs: 10_000 });
      if (!r.ok) throw new HttpError(r.status, url, `Hacker News API error ${r.status}`);
      return r;
    });
    data = await res.json();
  } catch (err) {
    return { status: { source: "Hacker News", status: "error", detail: `Hacker News search failed: ${(err as Error).message}` }, evidence: [], sources: [], articles: [] };
  }

  const articles: Article[] = (data?.hits ?? [])
    .filter((h) => h.url && hostMatchesDomain(hostOf(h.url), company.domain) && Date.parse(h.created_at) >= now - 1095 * DAY)
    .map((h) => ({ title: h.title, url: h.url!, publishedAt: h.created_at, summary: "" }))
    .filter((a, i, all) => all.findIndex((b) => b.url === a.url) === i)
    .slice(0, 25);

  if (!articles.length) {
    return { status: { source: "Hacker News", status: "not_found", detail: `No Hacker News stories linking to ${company.domain} in the last 3 years.` }, evidence: [], sources: [], articles: [] };
  }

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const a of articles) {
    const ref: SourceRef = { url: a.url, type: "hacker_news", title: a.title, publishedAt: a.publishedAt };
    sources.push(ref);
    for (const m of detectInText(a.title)) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "article", source: ref, evidence: `Article title "${a.title}" (shared on Hacker News)` });
    }
  }
  return {
    status: { source: "Hacker News", status: "ok", items: articles.length, detail: `${articles.length} stories linking to ${company.domain} (last 3 years); titles analyzed.` },
    evidence,
    sources,
    articles,
  };
}
