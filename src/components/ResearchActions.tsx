"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { notifyResearchStarted } from "@/components/LiveProgress";

type Queued = { queued: number; requested: number; alreadyQueued: number };

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, onOk: (r: T) => { title: string; description?: string } | null) {
    setBusy(true);
    try {
      const r = await fn();
      const msg = onOk(r);
      if (msg) toast({ kind: "success", ...msg });
      router.refresh();
      return r;
    } catch (err) {
      toast({ kind: "error", title: "Action failed", description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return { busy, run, router };
}

const queuedMessage = (r: Queued, what: string) => {
  notifyResearchStarted();
  return {
    title: r.queued ? `Research queued for ${r.queued} ${r.queued === 1 ? "company" : "companies"}` : "Already in progress",
    description: r.alreadyQueued ? `${r.alreadyQueued} ${what} already queued or running.` : undefined,
  };
};

export function ResearchAllButton({ disabled }: { disabled?: boolean }) {
  const { busy, run } = useAction();
  return (
    <Button
      variant="primary"
      loading={busy}
      disabled={disabled}
      onClick={() => run(() => api<Queued>("/api/research", { method: "POST", json: { scope: "all" } }), (r) => queuedMessage(r, "were"))}
    >
      <Play className="h-4 w-4" aria-hidden /> Research All
    </Button>
  );
}

export function ResearchNeedsAttentionButton({ count }: { count: number }) {
  const { busy, run } = useAction();
  if (!count) return null;
  return (
    <Button
      loading={busy}
      onClick={() => run(() => api<Queued>("/api/research", { method: "POST", json: { scope: "needs_attention" } }), (r) => queuedMessage(r, "were"))}
    >
      <RotateCcw className="h-4 w-4" aria-hidden /> Research {count} needing attention
    </Button>
  );
}

export function RefreshCompanyButton({ id, label = "Refresh", size = "md", status }: { id: string; label?: string; size?: "sm" | "md"; status?: string }) {
  const { busy, run } = useAction();
  const inFlight = status === "queued" || status === "researching";
  return (
    <Button
      size={size}
      loading={busy}
      disabled={inFlight}
      title={inFlight ? "Research already queued or running" : "Run research again now"}
      onClick={() => run(() => api<Queued>("/api/research", { method: "POST", json: { companyIds: [id] } }), (r) => queuedMessage(r, "was"))}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {status === "failed" ? "Retry" : label}
    </Button>
  );
}

export function RemoveCompanyButton({ id, name, redirectTo, size = "md" }: { id: string; name: string; redirectTo?: string; size?: "sm" | "md" }) {
  const { busy, run, router } = useAction();
  return (
    <Button
      size={size}
      variant="danger"
      loading={busy}
      aria-label={`Remove ${name}`}
      onClick={async () => {
        if (!window.confirm(`Remove ${name} from the watchlist? Its reports and history will be deleted.`)) return;
        const r = await run(() => api(`/api/companies/${id}`, { method: "DELETE" }), () => ({ title: `${name} removed` }));
        if (r && redirectTo) router.push(redirectTo);
      }}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {size === "md" ? "Remove" : null}
    </Button>
  );
}

export function RetryJobButton({ jobId }: { jobId: string }) {
  const { busy, run } = useAction();
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={() =>
        run(
          () => api(`/api/jobs/${jobId}/retry`, { method: "POST" }),
          () => {
            notifyResearchStarted();
            return { title: "Job re-queued" };
          },
        )
      }
    >
      <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
    </Button>
  );
}

export function ExportButton() {
  return (
    <a href="/api/export" className={buttonClass("secondary")} download>
      <Download className="h-4 w-4" aria-hidden /> Export CSV
    </a>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {done ? "Copied" : label}
    </Button>
  );
}
