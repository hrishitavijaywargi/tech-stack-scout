"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { notifyResearchStarted } from "@/components/LiveProgress";
import type { Company } from "@/lib/types";

/** Edit identification inputs (website, GitHub org, careers, blog) and optionally re-research. */
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
      if (refresh) {
        await api("/api/research", { method: "POST", json: { companyIds: [company.id] } });
        notifyResearchStarted();
      }
      toast({ kind: "success", title: "Company details saved", description: refresh ? "Research has been queued with the new details." : undefined });
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
    save({ website: val("website"), github: val("github"), careers_url: val("careers_url"), blog_url: val("blog_url") }, f.get("refresh") === "on");
  }

  const detectedUnconfirmed = !company.github_org && company.detected_github_org && company.detected_github_org_method === "name_match_unconfirmed";
  const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <form onSubmit={onSubmit} className="space-y-4 px-5 py-4">
      {detectedUnconfirmed && (
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
          Website
          <input name="website" defaultValue={company.domain ?? ""} placeholder="acme.com" className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          GitHub organization
          <input name="github" defaultValue={company.github_org ?? ""} placeholder={company.detected_github_org ?? "acme"} className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Careers page
          <input name="careers_url" defaultValue={company.careers_url ?? ""} placeholder="https://jobs.lever.co/acme" className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Engineering blog
          <input name="blog_url" defaultValue={company.blog_url ?? ""} placeholder="https://acme.com/engineering" className={input} />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="refresh" defaultChecked className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
          Re-run research after saving
        </label>
        <Button type="submit" variant="primary" loading={busy}>
          Save details
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
