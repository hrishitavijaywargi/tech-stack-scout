"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, X } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { notifyResearchStarted } from "@/components/LiveProgress";
import { parseCompanyCsv, type CsvParseResult } from "@/lib/companyInput";

const TEMPLATE = "name,website,github,careers_url,blog_url\nVercel,vercel.com,vercel,,\nHashiCorp,hashicorp.com,,,\n";

export function AddCompaniesButton({ variant = "primary", initialTab = "single" }: { variant?: "primary" | "secondary"; initialTab?: "single" | "csv" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add Companies
      </Button>
      {open && <AddCompaniesDialog initialTab={initialTab} onClose={() => setOpen(false)} />}
    </>
  );
}

function Field({ label, hint, ...rest }: { label: string; hint?: string } & React.ComponentProps<"input">) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <input
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        {...rest}
      />
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

function AddCompaniesDialog({ onClose, initialTab }: { onClose: () => void; initialTab: "single" | "csv" }) {
  const [tab, setTab] = useState<"single" | "csv">(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div ref={dialogRef} className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="add-title" className="text-base font-semibold text-slate-900">
            Add companies to the watchlist
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 pt-4">
          <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
            {(["single", "csv"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cx("rounded-md px-3 py-1.5 font-medium", tab === t ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
              >
                {t === "single" ? "One company" : "Upload CSV"}
              </button>
            ))}
          </div>
        </div>
        {tab === "single" ? <SingleForm onDone={onClose} /> : <CsvForm onDone={onClose} />}
      </div>
    </div>
  );
}

function SingleForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const company = Object.fromEntries(["name", "website", "github", "careers_url", "blog_url"].map((k) => [k, String(f.get(k) ?? "").trim() || null]));
    const research = f.get("research") === "on";
    setBusy(true);
    setError(null);
    try {
      await api("/api/companies", { method: "POST", json: { company, research } });
      toast({ kind: "success", title: `${company.name} added`, description: research ? "Research has been queued." : undefined });
      if (research) notifyResearchStarted();
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <Field label="Company name *" name="name" required maxLength={200} placeholder="e.g. Acme Robotics" autoComplete="off" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Website" name="website" placeholder="acme.com" hint="Used to confirm the GitHub org and find the blog." />
        <Field label="GitHub organization" name="github" placeholder="acme or https://github.com/acme" hint="Optional. Skips name matching." />
        <Field label="Careers page" name="careers_url" placeholder="https://jobs.lever.co/acme" hint="Greenhouse, Lever or Ashby boards are read automatically." />
        <Field label="Engineering blog" name="blog_url" placeholder="https://acme.com/engineering" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" name="research" defaultChecked className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
        Start research immediately
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy}>
          Add company
        </Button>
      </div>
    </form>
  );
}

function CsvForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [research, setResearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const rows = parsed?.rows ?? [];
    return {
      valid: rows.filter((r) => r.status === "valid").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
      dup: rows.filter((r) => r.status === "duplicate_in_file").length,
    };
  }, [parsed]);

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > 1_000_000) return setError("File is larger than 1 MB.");
    setFileName(file.name);
    setParsed(parseCompanyCsv(await file.text()));
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const rows = parsed.rows
        .filter((r) => r.status === "valid")
        .map((r) => ({ name: r.raw.name, website: r.raw.website || null, github: r.raw.github || null, careers_url: r.raw.careers_url || null, blog_url: r.raw.blog_url || null }));
      const res = await api<{ created: number; duplicates: { name: string; reason: string }[]; batch: { queued: number } | null }>("/api/companies/import", {
        method: "POST",
        json: { rows, research },
      });
      toast({
        kind: "success",
        title: `${res.created} ${res.created === 1 ? "company" : "companies"} added`,
        description: [res.duplicates.length ? `${res.duplicates.length} skipped (already on the watchlist)` : "", res.batch ? `${res.batch.queued} research jobs queued` : ""]
          .filter(Boolean)
          .join(" · "),
      });
      if (res.batch) notifyResearchStarted();
      router.refresh();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-5">
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
        <FileUp className="mx-auto h-6 w-6 text-slate-400" aria-hidden />
        <label className="mt-2 block cursor-pointer text-sm font-medium text-indigo-700 hover:text-indigo-800">
          <span>{fileName ? `Replace ${fileName}` : "Choose a CSV file"}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Columns: <code>name</code> (required), <code>website</code>, <code>github</code>, <code>careers_url</code>, <code>blog_url</code>. Up to 200 rows.{" "}
          <a className="text-indigo-700 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="tech-stack-scout-template.csv">
            Download template
          </a>
        </p>
      </div>

      {parsed && (
        <>
          {parsed.fileErrors.map((e) => (
            <p key={e} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {e}
            </p>
          ))}
          {parsed.rows.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone="green">{counts.valid} valid</Badge>
                {counts.invalid > 0 && <Badge tone="red">{counts.invalid} invalid</Badge>}
                {counts.dup > 0 && <Badge tone="amber">{counts.dup} duplicate in file</Badge>}
                <span className="text-slate-500">Companies already on the watchlist are skipped on import.</span>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Website</th>
                      <th className="px-3 py-2 font-medium">GitHub</th>
                      <th className="px-3 py-2 font-medium">Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsed.rows.map((r) => (
                      <tr key={r.line} className={r.status === "valid" ? "" : "bg-red-50/40"}>
                        <td className="px-3 py-1.5 text-slate-400">{r.line}</td>
                        <td className="px-3 py-1.5 font-medium text-slate-800">{r.raw.name || "—"}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.value?.domain ?? r.raw.website ?? ""}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.value?.github_org ?? r.raw.github ?? ""}</td>
                        <td className="px-3 py-1.5">
                          {r.status === "valid" ? <Badge tone="green">OK</Badge> : <span className="text-red-700">{r.errors.join("; ")}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={research} onChange={(e) => setResearch(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
        Queue research for every imported company
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!counts.valid} onClick={submit}>
          Import {counts.valid || ""} {counts.valid === 1 ? "company" : "companies"}
        </Button>
      </div>
    </div>
  );
}
