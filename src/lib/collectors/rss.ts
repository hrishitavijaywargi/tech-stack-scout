import Parser from "rss-parser";
import { HttpError, fetchWithTimeout, stripHtml, withRetry } from "@/lib/http";
import { detectInText } from "@/lib/techDictionary";
import { UA } from "@/lib/collectors/common";
import { ENGINEERING_KEYWORDS } from "@/lib/collectors/hn";
import type { BlogPost, EvidenceItem, SourceRef, SourceStatusEntry } from "@/lib/types";

/**
 * Engineering blog via RSS/Atom (parsed with rss-parser). Uses companies.blog_rss_url, or
 * auto-discovers a feed from <link rel="alternate"> on the homepage and blog-ish paths, and
 * reports the discovered URL so the pipeline can save it back to the company row.
 */

const parser = new Parser({ timeout: 10_000 });

/** Find RSS/Atom <link rel="alternate"> hrefs in an HTML page. Pure. */
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

const looksLikeFeed = (body: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(rss|feed|rdf:RDF)\b/i.test(body);

async function fetchText(url: string, blocked: number[]) {
  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, text/html;q=0.8, */*;q=0.5" },
        timeoutMs: 8_000,
        redirect: "follow",
      });
      if (res.status >= 500) throw new HttpError(res.status, url, `HTTP ${res.status}`);
      if (res.status === 403 || res.status === 429) blocked.push(res.status);
      if (!res.ok) return null;
      return { body: (await res.text()).slice(0, 2_000_000), finalUrl: res.url || url };
    },
    { retries: 1 },
  ).catch(() => null);
}

export function isTechnicalPost(title: string, snippet: string) {
  return detectInText(`${title}. ${snippet}`).length > 0 || ENGINEERING_KEYWORDS.test(title);
}

export interface RssCollection {
  posts: BlogPost[];
  feedUrl: string | null;
  discovered: string | null;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export async function collectRss(company: { domain: string; blog_rss_url: string | null }): Promise<RssCollection> {
  const blocked: number[] = [];
  const candidates = company.blog_rss_url
    ? [company.blog_rss_url]
    : [`https://engineering.${company.domain}`, `https://${company.domain}/engineering`, `https://${company.domain}/blog`, `https://blog.${company.domain}`, `https://${company.domain}`];

  let feedUrl: string | null = null;
  let xml: string | null = null;
  const tried = new Set<string>();
  outer: for (const page of candidates) {
    const res = await fetchText(page, blocked);
    if (!res) continue;
    if (looksLikeFeed(res.body)) {
      feedUrl = res.finalUrl;
      xml = res.body;
      break;
    }
    for (const link of discoverFeedLinks(res.body, res.finalUrl).slice(0, 3)) {
      if (tried.has(link)) continue;
      tried.add(link);
      const f = await fetchText(link, blocked);
      if (f && looksLikeFeed(f.body)) {
        feedUrl = link;
        xml = f.body;
        break outer;
      }
    }
  }

  // Pages had no <link rel="alternate">: try the common feed paths directly.
  if (!feedUrl && !company.blog_rss_url) {
    for (const path of ["/blog/feed.rss", "/blog/rss.xml", "/blog/feed", "/feed.xml", "/rss.xml", "/blog/index.xml", "/engineering/feed"]) {
      const f = await fetchText(`https://${company.domain}${path}`, blocked);
      if (f && looksLikeFeed(f.body)) {
        feedUrl = f.finalUrl;
        xml = f.body;
        break;
      }
    }
  }

  if (!feedUrl || !xml) {
    return {
      posts: [],
      feedUrl: null,
      discovered: null,
      evidence: [],
      sources: [],
      status: {
        status: "not_found",
        message: [
          company.blog_rss_url ? "No RSS/Atom feed at the saved blog_rss_url." : `No RSS/Atom feed discovered on ${company.domain}.`,
          blocked.length ? `The website refused automated requests (HTTP ${[...new Set(blocked)].join("/")}).` : "",
          company.blog_rss_url ? "" : "Set blog_rss_url to add one.",
        ]
          .filter(Boolean)
          .join(" "),
      },
    };
  }

  const feed = await parser.parseString(xml);
  const posts: BlogPost[] = (feed.items ?? [])
    .map((it) => {
      const snippet = stripHtml(it.contentSnippet ?? it.summary ?? it.content ?? "").slice(0, 280);
      const title = stripHtml(it.title ?? "");
      return { title, link: it.link ?? "", date: it.isoDate ?? (it.pubDate ? new Date(it.pubDate).toISOString() : null), snippet, technical: isTechnicalPost(title, snippet) };
    })
    .filter((p) => p.title && p.link)
    .sort((a, b) => Date.parse(b.date ?? "0") - Date.parse(a.date ?? "0"))
    .slice(0, 5);

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const p of posts) {
    const ref: SourceRef = { url: p.link, type: "engineering_blog", title: p.title, publishedAt: p.date };
    sources.push(ref);
    for (const m of detectInText(`${p.title}. ${p.snippet}`)) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "article", source: ref, evidence: `Blog post "${p.title}": "${m.snippet}"` });
    }
  }
  return {
    posts,
    feedUrl,
    discovered: company.blog_rss_url ? null : feedUrl,
    evidence,
    sources,
    status: {
      status: "ok",
      items: posts.length,
      url: feedUrl,
      message: `${feed.title ?? feedUrl}${company.blog_rss_url ? "" : " (auto-discovered)"}: ${posts.length} recent posts, ${posts.filter((p) => p.technical).length} technical.`,
    },
  };
}
