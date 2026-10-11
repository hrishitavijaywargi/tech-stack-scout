import "server-only";
import { env, requireEnv } from "@/lib/env";
import { HttpError, RateLimitError, fetchWithTimeout, withRetry } from "@/lib/http";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiUsage {
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
}

export function geminiModel() {
  return env().GEMINI_MODEL;
}

type GeminiOpts = {
  system: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
};

const overloaded = (err: unknown) => err instanceof QuotaError || (err instanceof HttpError && (err.status === 429 || err.status >= 500 || err.status === 0));

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

// Models known to be out of quota in this server instance, so later calls skip them at once.
const exhaustedUntil = new Map<string, number>();

/** Parse a 429 body: daily quotas (or long retry delays) become a QuotaError. */
export function quotaFromError(model: string, body: string): QuotaError | null {
  try {
    const j = JSON.parse(body) as { error?: { details?: { violations?: { quotaId?: string }[]; retryDelay?: string }[] } };
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

/**
 * One structured-output call to Gemini Flash. Retries 429/5xx/network errors with backoff;
 * if the primary Flash model is overloaded or out of quota, falls back to GEMINI_FALLBACK_MODEL
 * (also Flash). If every model is out of quota, throws RateLimitError so the queue pauses the
 * job until the quota resets instead of failing it.
 */
export async function geminiJson(opts: GeminiOpts): Promise<{ text: string; usage: GeminiUsage; model: string }> {
  const { GEMINI_FALLBACK_MODEL: fallback } = env();
  const models = [geminiModel(), ...(fallback && fallback !== geminiModel() ? [fallback] : [])];
  const quota: QuotaError[] = [];
  let lastErr: unknown;
  for (const [i, model] of models.entries()) {
    const until = exhaustedUntil.get(model);
    if (until && until > Date.now()) {
      quota.push(new QuotaError(model, new Date(until), "cached"));
      continue;
    }
    try {
      return await callModel(model, opts, i === 0 && models.length > 1 ? 1 : 2);
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
    const resetAt = new Date(Math.min(...quota.map((q) => q.resetAt.getTime())));
    throw new RateLimitError("Gemini (daily free-tier quota)", resetAt);
  }
  throw lastErr;
}

async function callModel(model: string, opts: GeminiOpts, retries: number): Promise<{ text: string; usage: GeminiUsage; model: string }> {
  const key = requireEnv("GEMINI_API_KEY");
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;

  return withRetry(
    async () => {
      const res = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        timeoutMs: 90_000,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: opts.responseSchema,
            temperature: opts.temperature ?? 0.4,
            // Thinking tokens count against this limit on Gemini 3.x; leave headroom for the JSON.
            maxOutputTokens: 16384,
          },
        }),
      });
      if (!res.ok) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        // Body may describe the error; never includes our key.
        const body = await res.text().catch(() => "");
        if (res.status === 429) {
          const q = quotaFromError(model, body);
          if (q) throw q;
        }
        const detail = body.slice(0, 300).replace(/\s+/g, " ");
        throw new HttpError(res.status, url, `Gemini API error ${res.status}: ${detail}`, retryAfter * 1000 || undefined);
      }
      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
        promptFeedback?: { blockReason?: string };
      };
      if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the request: ${data.promptFeedback.blockReason}`);
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join("");
      if (!text) throw new Error(`Gemini returned no text (finish reason: ${cand?.finishReason ?? "unknown"})`);
      const u = data.usageMetadata ?? {};
      return {
        text,
        model,
        usage: {
          promptTokens: u.promptTokenCount ?? 0,
          outputTokens: u.candidatesTokenCount ?? 0,
          thoughtsTokens: u.thoughtsTokenCount ?? 0,
          totalTokens: u.totalTokenCount ?? 0,
        },
      };
    },
    { retries, baseMs: 2000 },
  );
}

/** Lightweight connectivity check for the Settings page (metadata call, no generation). */
export async function checkGemini(): Promise<{ ok: boolean; detail: string }> {
  const key = env().GEMINI_API_KEY;
  if (!key) return { ok: false, detail: "GEMINI_API_KEY is not set" };
  const model = geminiModel();
  try {
    const res = await fetchWithTimeout(`${BASE}/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": key }, timeoutMs: 8000 });
    if (res.ok) return { ok: true, detail: `Connected · model ${model}` };
    if (res.status === 404) return { ok: false, detail: `Model "${model}" was not found — check GEMINI_MODEL` };
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, detail: `Key rejected (HTTP ${res.status})` };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}
