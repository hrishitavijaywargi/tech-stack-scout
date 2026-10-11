/** Small HTTP helpers shared by every external source: timeouts, retries, typed errors. */

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RateLimitError extends Error {
  constructor(
    public service: string,
    public resetAt: Date,
  ) {
    super(`${service} rate limit reached; resets at ${resetAt.toISOString()}`);
    this.name = "RateLimitError";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 15_000, ...rest } = init;
  const ctrl = new AbortController();
  // The timer is deliberately NOT cleared when headers arrive: it also bounds reading the
  // body (res.json()/res.text()), which would otherwise hang on a slow-streaming server.
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  (timer as { unref?: () => void }).unref?.();
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal, cache: "no-store" });
  } catch (err) {
    clearTimeout(timer);
    if ((err as Error).name === "AbortError") throw new HttpError(0, url, `Request timed out after ${timeoutMs} ms`);
    throw new HttpError(0, url, `Network error: ${(err as Error).message}`);
  }
}

/** Retry transient failures (network, 429, 5xx) with exponential backoff + jitter. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  { retries = 2, baseMs = 600, isRetryable = defaultRetryable }: { retries?: number; baseMs?: number; isRetryable?: (e: unknown) => boolean } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isRetryable(err)) throw err;
      const hinted = err instanceof HttpError && err.retryAfterMs ? err.retryAfterMs : 0;
      const backoff = Math.max(hinted, baseMs * 2 ** attempt) + Math.random() * 250;
      await sleep(Math.min(backoff, 15_000));
    }
  }
  throw lastErr;
}

function defaultRetryable(err: unknown) {
  if (err instanceof RateLimitError) return false;
  if (err instanceof HttpError) return err.status === 0 || err.status === 429 || err.status >= 500;
  return false;
}

/** Run async tasks with a fixed concurrency limit, preserving input order in the result. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function stripHtml(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** True when host equals domain or is a subdomain of it. */
export function hostMatchesDomain(host: string | null, domain: string | null) {
  if (!host || !domain) return false;
  return host === domain || host.endsWith(`.${domain}`);
}
