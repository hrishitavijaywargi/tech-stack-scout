"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Card, ProgressBar } from "@/components/ui";
import { relativeTime } from "@/lib/format";

interface Progress {
  batch: { id: string; label: string; createdAt: string; total: number; succeeded: number; failed: number; running: number; queued: number } | null;
  queued: number;
  running: number;
  companies: { id: string; research_status: string; last_researched_at: string | null; last_error: string | null }[];
}

const EVENT = "tss:research-started";

/** Call after any action that queues research so progress polling starts immediately. */
export function notifyResearchStarted() {
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Polls /api/jobs/progress every 3 s while research is queued or running, and refreshes the
 * server-rendered page whenever a company's status changes. Stops polling when idle.
 */
export function LiveProgress({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signature = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const res = await fetch("/api/jobs/progress", { cache: "no-store" });
      const json = (await res.json()) as Progress & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
      const sig = json.companies.map((c) => `${c.id}:${c.research_status}:${c.last_researched_at}`).sort().join("|");
      if (signature.current !== null && signature.current !== sig) router.refresh();
      signature.current = sig;
      if (json.queued + json.running > 0) timer.current = setTimeout(poll, 3000);
    } catch (err) {
      setError((err as Error).message);
      timer.current = setTimeout(poll, 10_000);
    }
  }, [router]);

  useEffect(() => {
    poll();
    const onStart = () => setTimeout(poll, 600);
    window.addEventListener(EVENT, onStart);
    return () => {
      window.removeEventListener(EVENT, onStart);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  if (error) return compact ? null : <p className="text-xs text-red-600">Live progress unavailable: {error}</p>;
  if (!data) return null;
  const active = data.queued + data.running > 0;
  const b = data.batch;
  const batchActive = b && b.queued + b.running > 0;
  if (!active && (!b || Date.now() - Date.parse(b.createdAt) > 86_400_000)) return null;

  const done = b ? b.succeeded + b.failed : 0;
  return (
    <Card className="mb-6 px-5 py-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
          {active && <Loader2 className="h-4 w-4 animate-spin text-indigo-600" aria-hidden />}
          {batchActive && b ? `${done} of ${b.total} companies researched` : active ? "Research in progress" : b ? `Last batch complete: ${b.succeeded} of ${b.total} researched` : ""}
        </div>
        <div className="text-xs text-slate-500">
          {b && (
            <>
              {b.label} · started {relativeTime(b.createdAt)}
            </>
          )}
        </div>
      </div>
      {b && (
        <div className="mt-3">
          <ProgressBar value={done} max={b.total} label="Batch progress" />
        </div>
      )}
      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          {data.running} running · {data.queued} queued{b?.failed ? ` · ${b.failed} failed in this batch` : ""}. Research runs on the server (3 companies at a time) and continues if you close this page.
        </p>
      )}
    </Card>
  );
}
