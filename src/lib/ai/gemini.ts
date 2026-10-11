import "server-only";
import { ApiError, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { env, requireEnv } from "@/lib/env";
import { HttpError, RateLimitError, withRetry } from "@/lib/http";

/**
 * Gemini Flash via the official @google/genai SDK. Every AI task in the app goes through here.
 * - structured JSON output (responseSchema) for insights
 * - Google Search grounding for web research (citations returned in groundingMetadata)
 * - retries 429/5xx with backoff; falls back to GEMINI_FALLBACK_MODEL (also Flash) when the
 *   primary is overloaded or out of quota; if every model is out of daily quota, throws
 *   RateLimitError so the job queue pauses until the reset instead of failing jobs.
 */

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

export function geminiModel() {
  return env().GEMINI_MODEL;
}

let client: GoogleGenAI | null = null;
function ai() {
  if (!client) client = new GoogleGenAI({ apiKey: requireEnv("GEMINI_API_KEY") });
  return client;
}

/** A per-day (or other long-window) quota was exhausted: retrying soon is pointless. */
export class QuotaError extends Error {
  constructor(
    public model: string,
    public resetAt: Date,
    detail: string,
  ) {
    super(`Gemini quota exhausted for ${model} (${detail}); resets ${resetAt.toISOString().slice(0, 16)}Z`);
    this.name = "QuotaError";
  }
}

/** Parse a 429 body: daily quotas (or long retry delays) become a QuotaError. Pure. */
export function quotaFromError(model: string, body: string): QuotaError | null {
  try {
    const json = body.slice(body.indexOf("{"));
    const j = JSON.parse(json) as { error?: { details?: { violations?: { quotaId?: string }[]; retryDelay?: string }[] } };
    const details = j.error?.details ?? [];
    const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => v.quotaId ?? "");
    const delayS = Number(/^(\d+(?:\.\d+)?)s$/.exec(details.find((d) => d.retryDelay)?.retryDelay ?? "")?.[1] ?? 0);
    const perDay = quotaIds.some((q) => /PerDay/i.test(q));
    if (!perDay && delayS < 120) return null;
    return new QuotaError(model, new Date(Date.now() + Math.max(delayS, 60) * 1000), quotaIds.find(Boolean) ?? "quota");
  } catch {
    return null;
  }
}

const overloaded = (err: unknown) => err instanceof QuotaError || (err instanceof HttpError && (err.status === 429 || err.status >= 500 || err.status === 0));

// Models known to be out of quota in this server instance, so later calls skip them at once.
const exhaustedUntil = new Map<string, number>();

function usageOf(r: GenerateContentResponse): GeminiUsage {
  const u = r.usageMetadata ?? {};
  return { promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, thoughtsTokens: u.thoughtsTokenCount ?? 0, totalTokens: u.totalTokenCount ?? 0 };
}

/** One SDK call, with errors mapped onto the app's retry/rate-limit types. */
async function generate(model: string, request: Parameters<GoogleGenAI["models"]["generateContent"]>[0]["config"] & { prompt: string }, retries: number) {
  const { prompt, ...config } = request;
  return withRetry(
    async () => {
      try {
        const r = await ai().models.generateContent({ model, contents: prompt, config: { ...config, httpOptions: { timeout: 90_000 } } });
        if (r.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${r.promptFeedback.blockReason}`);
        return r;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 429) {
            const q = quotaFromError(model, err.message);
            if (q) throw q;
          }
          throw new HttpError(err.status, `${GEMINI_ORIGIN}/${model}`, `Gemini API error ${err.status}: ${err.message.slice(0, 240)}`);
        }
        if (err instanceof HttpError || err instanceof QuotaError) throw err;
        const msg = (err as Error).message ?? String(err);
        if (/fetch failed|network|timed? ?out|abort/i.test(msg)) throw new HttpError(0, `${GEMINI_ORIGIN}/${model}`, `Gemini network error: ${msg}`);
        throw err;
      }
    },
    { retries, baseMs: 2000 },
  );
}

/** Try the primary Flash model, then the fallback; pause the queue if all are out of quota. */
async function withModels<T>(fn: (model: string, retries: number) => Promise<T>, { preferFallback = false } = {}): Promise<T> {
  const { GEMINI_FALLBACK_MODEL: fallback } = env();
  const models = [geminiModel(), ...(fallback && fallback !== geminiModel() ? [fallback] : [])];
  // Free-tier quotas are per model: web research starts on the fallback so the two AI calls
  // per company draw on different daily quotas.
  if (preferFallback) models.reverse();
  const quota: QuotaError[] = [];
  let lastErr: unknown;
  for (const [i, model] of models.entries()) {
    const until = exhaustedUntil.get(model);
    if (until && until > Date.now()) {
      quota.push(new QuotaError(model, new Date(until), "cached"));
      continue;
    }
    try {
      return await fn(model, i === 0 && models.length > 1 ? 1 : 2);
    } catch (err) {
      lastErr = err;
      if (err instanceof QuotaError) {
        exhaustedUntil.set(model, err.resetAt.getTime());
        quota.push(err);
      }
      if (!overloaded(err)) throw err;
      if (i < models.length - 1) console.warn(`[gemini] ${model} unavailable (${(err as Error).message.slice(0, 90)}); trying ${models[i + 1]}`);
    }
  }
  if (quota.length === models.length) {
    throw new RateLimitError("Gemini (daily free-tier quota)", new Date(Math.min(...quota.map((q) => q.resetAt.getTime()))));
  }
  throw lastErr;
}

/** Structured JSON output (responseSchema). */
export async function geminiJson(opts: {
  system: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
}): Promise<{ text: string; usage: GeminiUsage; model: string }> {
  return withModels(async (model, retries) => {
    const r = await generate(
      model,
      {
        prompt: opts.prompt,
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseSchema: opts.responseSchema,
        temperature: opts.temperature ?? 0.4,
        // Thinking tokens count against this limit on Gemini 3.x; leave headroom for the JSON.
        maxOutputTokens: 16384,
      },
      retries,
    );
    const text = r.text;
    if (!text) throw new Error(`Gemini returned no text (finish reason: ${r.candidates?.[0]?.finishReason ?? "unknown"})`);
    return { text, usage: usageOf(r), model };
  });
}

export interface GroundedResult {
  text: string;
  /** Grounding chunks in API order (indices referenced by `supports`). */
  chunks: { uri: string; title: string }[];
  /** Which parts of the answer text are supported by which chunks. */
  supports: { text: string; chunkIndices: number[] }[];
  queries: string[];
  usage: GeminiUsage;
  model: string;
}

/** Google Search grounding: returns the answer plus the grounding metadata from the API. */
export async function geminiGrounded(opts: { system: string; prompt: string }): Promise<GroundedResult> {
  return withModels(async (model, retries) => {
    const r = await generate(model, { prompt: opts.prompt, systemInstruction: opts.system, tools: [{ googleSearch: {} }], temperature: 0.3 }, retries);
    const meta = r.candidates?.[0]?.groundingMetadata;
    return {
      text: r.text ?? "",
      chunks: (meta?.groundingChunks ?? []).map((c) => ({ uri: c.web?.uri ?? "", title: c.web?.title ?? c.web?.uri ?? "" })),
      supports: (meta?.groundingSupports ?? []).map((s) => ({ text: s.segment?.text ?? "", chunkIndices: s.groundingChunkIndices ?? [] })),
      queries: meta?.webSearchQueries ?? [],
      usage: usageOf(r),
      model,
    };
  }, { preferFallback: true });
}

/** Lightweight connectivity check for the Settings page (model metadata, no generation). */
export async function checkGemini(): Promise<{ ok: boolean; detail: string }> {
  if (!env().GEMINI_API_KEY) return { ok: false, detail: "GEMINI_API_KEY is not set" };
  const model = geminiModel();
  try {
    await ai().models.get({ model });
    return { ok: true, detail: `Connected · ${model} (fallback ${env().GEMINI_FALLBACK_MODEL})` };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404) return { ok: false, detail: `Model "${model}" was not found — check GEMINI_MODEL` };
      if ([400, 401, 403].includes(err.status)) return { ok: false, detail: `Key rejected (HTTP ${err.status})` };
      return { ok: false, detail: `HTTP ${err.status}` };
    }
    return { ok: false, detail: (err as Error).message };
  }
}
