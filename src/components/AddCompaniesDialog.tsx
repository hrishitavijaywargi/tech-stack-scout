"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, Wand2, X } from "lucide-react";
import { Badge, Button, cx } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { notifyResearchStarted } from "@/components/LiveProgress";
import { inputClass } from "@/components/CompanyDetailsForm";
import { parseCompanyCsv, type CsvParseResult } from "@/lib/companyInput";

const TEMPLATE = "name,website,github,job_board_provider,job_board_slug,blog_rss_url\nStripe,stripe.com,stripe,greenhouse,stripe,\nHashiCorp,hashicorp.com,,,,\n";

export function AddCompaniesButton({ variant = "primary", initialTab = "single" }: { variant?: "primary" | "secondary"; initialTab?: "single" | "csv" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden /> Add company
      </Button>
      {open && <AddCompaniesDialog initialTab={initialTab} onClose={() => setOpen(false)} />}
    </>
  );
}

function AddCompaniesDialog({ onClose, initialTab }: { onClose: () => void; initialTab: "single" | "csv" }) {
  const [tab, setTab] = useState<"single" | "csv">(initialTab);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={dialogRef} className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="add-title" className="text-base font-semibold text-slate-900">
            Add to the watchlist
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
                className={cx("rounded-md px-3 py-1.5 font-medium", tab === t ? "bg-surface text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900")}
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

interface Detected {
  domain: string;
  github: { login: string | null; method: string; note: string };
  job_board: { provider: string; slug: string; postings: number } | null;
  blog_rss_url: string | null;
}

function SingleForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", website: "", github: "", job_board_provider: "", job_board_slug: "", blog_rss_url: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function detect() {
    setDetecting(true);
    setError(null);
    setDetectNote(null);
    try {
      const d = await api<Detected>("/api/companies/detect", { method: "POST", json: { name: f.name, website: f.website } });
      setF((s) => ({
        ...s,
        website: d.domain,
        github: s.github || d.github.login || "",
        job_board_provider: s.job_board_provider || d.job_board?.provider || "",
        job_board_slug: s.job_board_slug || d.job_board?.slug || "",
        blog_rss_url: s.blog_rss_url || d.blog_rss_url || "",
      }));
      setDetectNote(
        [
          d.github.login ? `GitHub: ${d.github.login} (${d.github.method === "verified_domain" ? "verified via website" : d.github.method === "name_match_unconfirmed" ? "name match — please confirm" : d.github.method})` : "GitHub: none found",
          d.job_board ? `Jobs: ${d.job_board.provider}/${d.job_board.slug} (${d.job_board.postings} postings)` : "Jobs: no public board found",
          d.blog_rss_url ? "Blog feed found" : "No blog feed found",
        ].join(" · "),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const research = new FormData(e.currentTarget).get("research") === "on";
    const company = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]));
    setBusy(true);
    setError(null);
    try {
      await api("/api/companies", { method: "POST", json: { company, research } });
      toast({ kind: "success", title: `${f.name} added`, description: research ? "Research has been queued." : undefined });
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
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Company name *
          <input value={f.name} onChange={set("name")} required maxLength={200} placeholder="Acme Robotics" autoComplete="off" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Domain *
          <input value={f.website} onChange={set("website")} required placeholder="acme.com" className={inputClass} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
        <Button size="sm" onClick={detect} loading={detecting} disabled={!f.name.trim() || !f.website.trim()}>
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> Auto-detect sources
        </Button>
        <span className="text-xs text-slate-500">{detectNote ?? "Finds the GitHub org, public job board and blog feed. Everything below is optional."}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          GitHub organization
          <input value={f.github} onChange={set("github")} placeholder="acme or https://github.com/acme" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Engineering blog RSS
          <input value={f.blog_rss_url} onChange={set("blog_rss_url")} placeholder="https://acme.com/blog/feed.xml" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Job board
          <select value={f.job_board_provider} onChange={set("job_board_provider")} className={inputClass}>
            <option value="">Auto-detect on refresh</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Board slug
          <input value={f.job_board_slug} onChange={set("job_board_slug")} placeholder="acme" className={inputClass} />
        </label>
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
    return { valid: rows.filter((r) => r.status === "valid").length, invalid: rows.filter((r) => r.status === "invalid").length, dup: rows.filter((r) => r.status === "duplicate_in_file").length };
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
      const rows = parsed.rows.filter((r) => r.status === "valid").map((r) => r.raw);
      const res = await api<{ created: number; duplicates: { name: string }[]; batch: { queued: number } | null }>("/api/companies/import", { method: "POST", json: { rows, research } });
      toast({
        kind: "success",
        title: `${res.created} ${res.created === 1 ? "company" : "companies"} added`,
        description: [res.duplicates.length ? `${res.duplicates.length} skipped (already on the watchlist)` : "", res.batch ? `${res.batch.queued} research jobs queued` : ""].filter(Boolean).join(" · "),
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
          Columns: <code>name</code>, <code>website</code> (required), <code>github</code>, <code>job_board_provider</code>, <code>job_board_slug</code>, <code>blog_rss_url</code>. Up to 200 rows.{" "}
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
                <span className="text-slate-500">Companies already on the watchlist are skipped.</span>
              </div>
              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Company</th>
                      <th className="px-3 py-2 font-medium">Domain</th>
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
                        <td className="px-3 py-1.5">{r.status === "valid" ? <Badge tone="green">OK</Badge> : <span className="text-red-700">{r.errors.join("; ")}</span>}</td>
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
