"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { notifyResearchStarted } from "@/components/LiveProgress";
import type { Company } from "@/lib/types";

export const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

/** Edit a company's sources (domain, GitHub org, job board, blog feed, notes) and optionally re-research. */
export function CompanyDetailsForm({ company }: { company: Company }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: Record<string, string | null>, refresh: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/companies/${company.id}`, { method: "PATCH", json: patch });
      if (refresh && company.is_active) {
        await api(`/api/companies/${company.id}/refresh`, { method: "POST" });
        notifyResearchStarted();
      }
      toast({ kind: "success", title: "Company sources saved", description: refresh ? "Research has been queued with the new sources." : undefined });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const val = (k: string) => String(f.get(k) ?? "").trim() || null;
    save(
      {
        website: val("website") ?? "",
        github: val("github"),
        job_board_provider: val("job_board_provider"),
        job_board_slug: val("job_board_slug"),
        blog_rss_url: val("blog_rss_url"),
        notes: val("notes"),
      },
      f.get("refresh") === "on",
    );
  }

  const unconfirmed = !company.github_org && company.detected_github_org && company.detected_github_org_method === "name_match_unconfirmed";

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
      {unconfirmed && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Is <strong>github.com/{company.detected_github_org}</strong> really {company.name}&apos;s organization?
          </span>
          <Button size="sm" loading={busy} onClick={() => save({ github: company.detected_github_org }, true)}>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Confirm &amp; refresh
          </Button>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Domain *
          <input name="website" required defaultValue={company.domain} placeholder="acme.com" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          GitHub organization
          <input name="github" defaultValue={company.github_org ?? ""} placeholder={company.detected_github_org ?? "acme"} className={inputClass} />
        </label>
        <div className="grid grid-cols-5 gap-2">
          <label className="col-span-2 block text-sm font-medium text-slate-700">
            Job board
            <select name="job_board_provider" defaultValue={company.job_board_provider ?? ""} className={inputClass}>
              <option value="">Auto-detect</option>
              <option value="greenhouse">Greenhouse</option>
              <option value="lever">Lever</option>
              <option value="ashby">Ashby</option>
            </select>
          </label>
          <label className="col-span-3 block text-sm font-medium text-slate-700">
            Board slug
            <input name="job_board_slug" defaultValue={company.job_board_slug ?? ""} placeholder="acme" className={inputClass} />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Engineering blog RSS
          <input name="blog_rss_url" defaultValue={company.blog_rss_url ?? ""} placeholder="Auto-discovered when empty" className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
          Notes
          <textarea name="notes" defaultValue={company.notes ?? ""} rows={2} maxLength={2000} className={inputClass} />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="refresh" defaultChecked={company.is_active} disabled={!company.is_active} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
          Refresh research after saving
        </label>
        <Button type="submit" variant="primary" loading={busy}>
          Save sources
        </Button>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
