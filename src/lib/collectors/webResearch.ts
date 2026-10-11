import "server-only";
import { geminiGrounded, type GroundedResult } from "@/lib/ai/gemini";
import { detectInText } from "@/lib/techDictionary";
import type { EvidenceItem, SourceRef, SourceStatusEntry, WebResearch } from "@/lib/types";

/**
 * Supplemental web research with Gemini Flash + Google Search grounding: conference talks,
 * engineering posts, migrations and announcements from the last 12 months.
 *
 * Traceability: each finding's source URLs come from the API's groundingSupports (which part of
 * the answer is backed by which search result), not from the model's own text. A finding with
 * no grounding support is dropped. Treated as weak evidence — never the only source for a claim.
 */

const SYSTEM = `You are a research assistant with Google Search. Search before answering.
Only report what search results actually say about the company; never guess or fill gaps.
Prefer the company's own engineering blog, conference talk pages and reputable tech press.`;

function prompt(company: { name: string; domain: string }) {
  return `Search the web for notable engineering items about ${company.name} (${company.domain}) from the last 12 months:
conference talks by its engineers, engineering blog posts, technology migrations or rewrites, infrastructure or platform announcements, open-source releases.

List up to 5 items, one per line, exactly in this format (no other text, no markdown):
ITEM: <title> || <YYYY-MM or unknown> || <talk|blog|migration|announcement|open_source|other> || <one factual sentence naming the technologies involved>
If nothing relevant is found, answer: NONE`;
}

export interface ParsedItem {
  line: string;
  title: string;
  date: string | null;
  type: string;
  summary: string;
}

/** Parse "ITEM: title || date || type || summary" lines. Pure. */
export function parseItems(text: string): ParsedItem[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^[-*•]\s*/, ""))
    .filter((l) => /^ITEM:/i.test(l))
    .map((line) => {
      const [title = "", date = "", type = "", ...rest] = line.replace(/^ITEM:\s*/i, "").split("||").map((s) => s.trim().replace(/\*\*/g, ""));
      return { line, title, date: /^\d{4}-\d{2}$/.test(date) ? date : null, type: type.toLowerCase() || "other", summary: rest.join(" ").trim() };
    })
    .filter((i) => i.title.length >= 3 && i.summary.length >= 10);
}

/** Source URLs for one answer line: grounding supports whose text lies within that line. Pure. */
export function citationsForLine(line: string, g: Pick<GroundedResult, "supports" | "chunks">): { uri: string; title: string }[] {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const l = norm(line);
  const idx = new Set<number>();
  for (const s of g.supports) {
    const t = norm(s.text);
    if (t.length >= 12 && (l.includes(t) || t.includes(l.slice(0, 60)))) s.chunkIndices.forEach((i) => idx.add(i));
  }
  return [...idx].map((i) => g.chunks[i]).filter((c): c is { uri: string; title: string } => Boolean(c?.uri));
}

export interface WebResearchCollection {
  research: WebResearch;
  evidence: EvidenceItem[];
  sources: SourceRef[];
  status: Omit<SourceStatusEntry, "duration_ms">;
}

export function emptyResearch(): WebResearch {
  return { findings: [], citations: [], queries: [], model: null };
}

export async function collectWebResearch(company: { name: string; domain: string }): Promise<WebResearchCollection> {
  const g = await geminiGrounded({ system: SYSTEM, prompt: prompt(company) });
  const findings: WebResearch["findings"] = [];
  const used: { uri: string; title: string }[] = [];
  for (const item of parseItems(g.text).slice(0, 5)) {
    const cites = citationsForLine(item.line, g);
    if (!cites.length) continue; // not grounded → not reported
    findings.push({ title: item.title, summary: item.summary, date: item.date, url: cites[0].uri, type: item.type });
    for (const c of cites) if (!used.some((u) => u.uri === c.uri)) used.push(c);
  }

  const evidence: EvidenceItem[] = [];
  const sources: SourceRef[] = [];
  for (const f of findings) {
    const ref: SourceRef = { url: f.url!, type: "web_research", title: f.title, publishedAt: f.date ? new Date(`${f.date}-01T00:00:00Z`).toISOString() : null };
    sources.push(ref);
    for (const m of detectInText(`${f.title}. ${f.summary}`)) {
      evidence.push({ technology: m.def.name, category: m.def.category, kind: "web_research", source: ref, evidence: `Web research: "${f.title}" — ${f.summary.slice(0, 160)}` });
    }
  }
  const allCitations = g.chunks.filter((c) => c.uri).filter((c, i, all) => all.findIndex((x) => x.uri === c.uri) === i);
  return {
    research: { findings, citations: (used.length ? used : allCitations).slice(0, 15), queries: g.queries, model: g.model },
    evidence,
    sources,
    status: findings.length
      ? { status: "ok", items: findings.length, message: `${findings.length} grounded findings from ${g.queries.length} Google searches, ${allCitations.length} sources (${g.model}).` }
      : { status: "not_found", message: `No grounded findings (${g.queries.length} searches, ${allCitations.length} sources).` },
  };
}
