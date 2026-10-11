import "server-only";
import { env, requireEnv } from "@/lib/env";
import { HttpError, fetchWithTimeout, withRetry } from "@/lib/http";

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

/** One structured-output call to Gemini Flash. Retries 429/5xx/network errors with backoff. */
export async function geminiJson(opts: {
  system: string;
  prompt: string;
  responseSchema: Record<string, unknown>;
  temperature?: number;
}): Promise<{ text: string; usage: GeminiUsage; model: string }> {
  const key = requireEnv("GEMINI_API_KEY");
  const model = geminiModel();
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
            maxOutputTokens: 8192,
          },
        }),
      });
      if (!res.ok) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        // Body may describe the error; never includes our key.
        const detail = (await res.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
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
    { retries: 3, baseMs: 2000 },
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
