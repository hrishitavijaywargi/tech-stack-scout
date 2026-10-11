"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import type { AppSettings } from "@/lib/types";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/settings", {
        method: "PUT",
        json: {
          product_name: String(f.get("product_name")),
          product_description: String(f.get("product_description")),
          refresh_interval_days: Number(f.get("refresh_interval_days")),
          max_repos: Number(f.get("max_repos")),
          include_job_boards: f.get("include_job_boards") === "on",
          include_blogs: f.get("include_blogs") === "on",
          include_hacker_news: f.get("include_hacker_news") === "on",
        },
      });
      toast({ kind: "success", title: "Settings saved", description: "They apply to the next research run." });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const check = (name: string, label: string, hint: string, value: boolean) => (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={value} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={submit} className="divide-y divide-slate-100">
      <fieldset className="space-y-4 px-5 py-5">
        <legend className="text-sm font-semibold text-slate-900">Your product</legend>
        <p className="-mt-2 text-xs text-slate-500">Gemini uses this to explain relevance and write outreach openings.</p>
        <label className="block text-sm font-medium text-slate-700">
          Product name
          <input name="product_name" defaultValue={settings.product_name} required maxLength={80} className={input} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          What it does and who it fits
          <textarea name="product_description" defaultValue={settings.product_description} required minLength={40} maxLength={2000} rows={5} className={input} />
        </label>
      </fieldset>

      <fieldset className="grid gap-4 px-5 py-5 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-slate-900 sm:col-span-2">Refresh schedule and research depth</legend>
        <label className="block text-sm font-medium text-slate-700">
          Refresh every (days)
          <input type="number" name="refresh_interval_days" min={1} max={60} defaultValue={settings.refresh_interval_days} className={input} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Default 7 (weekly). Applies from each company&apos;s next completed run.</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Repositories analyzed in depth per company
          <input type="number" name="max_repos" min={3} max={25} defaultValue={settings.max_repos} className={input} />
          <span className="mt-1 block text-xs font-normal text-slate-500">More repos = better coverage, more GitHub API calls.</span>
        </label>
      </fieldset>

      <fieldset className="space-y-3 px-5 py-5">
        <legend className="mb-2 text-sm font-semibold text-slate-900">Sources</legend>
        <p className="text-xs text-slate-500">GitHub (public repositories) is always used.</p>
        {check("include_job_boards", "Job postings", "Greenhouse, Lever and Ashby public job-board APIs.", settings.include_job_boards)}
        {check("include_blogs", "Engineering blog", "RSS/Atom feeds discovered on the company website or the blog URL you provide.", settings.include_blogs)}
        {check("include_hacker_news", "Hacker News", "Stories linking to the company's domain (official Algolia API).", settings.include_hacker_news)}
      </fieldset>

      <div className="flex items-center justify-end gap-3 px-5 py-4">
        {error && (
          <p role="alert" className="mr-auto text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
