import type { SourceStatusEntry } from "@/lib/types";

/** Run a collector, timing it and turning a thrown error into an "error" status (never rethrows). */
export async function timed<T>(
  fn: () => Promise<{ value: T; status: Omit<SourceStatusEntry, "duration_ms"> }>,
  fallback: T,
  rethrow: (err: unknown) => boolean = () => false,
): Promise<{ value: T; status: SourceStatusEntry }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { value: r.value, status: { ...r.status, duration_ms: Date.now() - t0 } };
  } catch (err) {
    if (rethrow(err)) throw err;
    return { value: fallback, status: { status: "error", message: (err as Error).message.slice(0, 300), duration_ms: Date.now() - t0 } };
  }
}

export const DAY = 86_400_000;
export const UA = "tech-stack-scout/1.0 (+https://github.com/hrishitavijaywargi/tech-stack-scout)";
