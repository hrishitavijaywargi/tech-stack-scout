"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, Check, Copy, Download, Play, RefreshCw, RotateCcw, Trash2, UserMinus } from "lucide-react";
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

const queuedMessage = (r: Queued) => {
  notifyResearchStarted();
  return {
    title: r.queued ? `Research queued for ${r.queued} ${r.queued === 1 ? "company" : "companies"}` : "Already in progress",
    description: r.alreadyQueued ? `${r.alreadyQueued} already queued or running.` : "Runs on the server; you can close this page.",
  };
};

export function ResearchScopeButton({ scope, label, variant = "secondary", icon = "play" }: { scope: "all" | "needs_attention" | "stale"; label: string; variant?: "primary" | "secondary"; icon?: "play" | "refresh" | "retry" }) {
  const { busy, run } = useAction();
  const Icon = icon === "play" ? Play : icon === "refresh" ? RefreshCw : RotateCcw;
  return (
    <Button variant={variant} loading={busy} onClick={() => run(() => api<Queued>("/api/research", { method: "POST", json: { scope } }), queuedMessage)}>
      <Icon className="h-4 w-4" aria-hidden /> {label}
    </Button>
  );
}

export function RefreshCompanyButton({ id, label = "Refresh now", size = "md", status }: { id: string; label?: string; size?: "sm" | "md"; status?: string }) {
  const { busy, run } = useAction();
  const inFlight = status === "queued" || status === "researching";
  return (
    <Button
      size={size}
      loading={busy}
      disabled={inFlight}
      title={inFlight ? "Research already queued or running" : "Run research again now"}
      aria-label={size === "sm" ? `${status === "failed" ? "Retry" : label}` : undefined}
      onClick={() => run(() => api<Queued>(`/api/companies/${id}/refresh`, { method: "POST" }), queuedMessage)}
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {size === "md" ? (status === "failed" ? "Retry" : label) : null}
    </Button>
  );
}

/** "Remove" = deactivate (is_active=false). History is kept; restore from Settings. */
export function RemoveCompanyButton({ id, name, redirectTo, size = "md" }: { id: string; name: string; redirectTo?: string; size?: "sm" | "md" }) {
  const { busy, run, router } = useAction();
  return (
    <Button
      size={size}
      variant="danger"
      loading={busy}
      aria-label={`Remove ${name} from the watchlist`}
      title="Remove from watchlist"
      onClick={async () => {
        if (!window.confirm(`Remove ${name} from the watchlist?\n\nIt stops being refreshed. Its history is kept and it can be restored from Settings.`)) return;
        const r = await run(() => api(`/api/companies/${id}`, { method: "PATCH", json: { is_active: false } }), () => ({ title: `${name} removed from the watchlist` }));
        if (r && redirectTo) router.push(redirectTo);
      }}
    >
      <UserMinus className="h-3.5 w-3.5" aria-hidden /> {size === "md" ? "Remove" : null}
    </Button>
  );
}

export function RestoreCompanyButton({ id, name }: { id: string; name: string }) {
  const { busy, run } = useAction();
  return (
    <Button size="sm" loading={busy} onClick={() => run(() => api(`/api/companies/${id}`, { method: "PATCH", json: { is_active: true } }), () => ({ title: `${name} restored to the watchlist` }))}>
      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden /> Restore
    </Button>
  );
}

export function DeleteCompanyButton({ id, name }: { id: string; name: string }) {
  const { busy, run, router } = useAction();
  return (
    <Button
      size="sm"
      variant="danger"
      loading={busy}
      onClick={async () => {
        if (!window.confirm(`Permanently delete ${name} and all of its snapshots? This cannot be undone.`)) return;
        const r = await run(() => api(`/api/companies/${id}`, { method: "DELETE" }), () => ({ title: `${name} deleted` }));
        if (r) router.push("/");
      }}
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete permanently
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
