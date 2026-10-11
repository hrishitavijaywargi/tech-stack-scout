"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { api, useToast } from "@/components/Toast";
import { inputClass } from "@/components/CompanyDetailsForm";
import type { AppSettings, ProductProfile } from "@/lib/types";

function useSave(url: string, title: string) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(json: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(url, { method: "PUT", json });
      toast({ kind: "success", title, description: "Applies to the next research run." });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** Product profile: shapes the fit score and every outreach line. */
export function ProductProfileForm({ profile }: { profile: ProductProfile }) {
  const { busy, error, save } = useSave("/api/product-profile", "Product profile saved");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save({
      product_name: String(f.get("product_name")),
      one_liner: String(f.get("one_liner")),
      description: String(f.get("description")),
      target_languages: list(f.get("target_languages")),
      target_clouds: list(f.get("target_clouds")),
      target_signals: list(f.get("target_signals")),
    });
  }
  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          Product name
          <input name="product_name" defaultValue={profile.product_name} required maxLength={80} className={inputClass} />
        </label>
        <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
          One-liner
          <input name="one_liner" defaultValue={profile.one_liner} required minLength={10} maxLength={200} className={inputClass} />
        </label>
      </div>
      <label className="block text-sm font-medium text-slate-700">
        Description
        <textarea name="description" defaultValue={profile.description} required minLength={40} maxLength={2000} rows={4} className={inputClass} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-slate-700">
          Target languages
          <input name="target_languages" defaultValue={profile.target_languages.join(", ")} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Comma-separated, e.g. Go, TypeScript</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Target clouds
          <input name="target_clouds" defaultValue={profile.target_clouds.join(", ")} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">AWS, Google Cloud, Microsoft Azure…</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Target signals
          <input name="target_signals" defaultValue={profile.target_signals.join(", ")} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Microservices, Kubernetes, Monorepo…</span>
        </label>
      </div>
      <div className="flex items-center justify-end gap-3">
        {error && (
          <p role="alert" className="mr-auto text-sm text-red-700">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" loading={busy}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

/** Refresh interval, research depth and which optional sources to use. */
export function SettingsForm({ settings }: { settings: AppSettings }) {
  const { busy, error, save } = useSave("/api/settings", "Settings saved");
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save({
      refresh_interval_days: Number(f.get("refresh_interval_days")),
      max_repos: Number(f.get("max_repos")),
      include_job_boards: f.get("include_job_boards") === "on",
      include_blogs: f.get("include_blogs") === "on",
      include_hacker_news: f.get("include_hacker_news") === "on",
    });
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
    <form onSubmit={submit} className="space-y-5 px-5 py-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-slate-700">
          Refresh every (days)
          <input type="number" name="refresh_interval_days" min={1} max={60} defaultValue={settings.refresh_interval_days} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Weekly by default. Applies from each company&apos;s next completed run.</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Repositories scanned in depth per company
          <input type="number" name="max_repos" min={3} max={25} defaultValue={settings.max_repos} className={inputClass} />
          <span className="mt-1 block text-xs font-normal text-slate-500">Languages/activity always cover up to 300 repos; this sets file-level scanning.</span>
        </label>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium text-slate-700">Optional sources</legend>
        <p className="text-xs text-slate-500">GitHub, DNS and certificate logs are always used. Web research is controlled by WEB_RESEARCH_ENABLED.</p>
        {check("include_job_boards", "Job postings", "Greenhouse, Lever and Ashby public job-board APIs.", settings.include_job_boards)}
        {check("include_blogs", "Engineering blog", "RSS/Atom feed (saved or auto-discovered).", settings.include_blogs)}
        {check("include_hacker_news", "Hacker News", "Engineering stories from the last 12 months (Algolia API).", settings.include_hacker_news)}
      </fieldset>
      <div className="flex items-center justify-end gap-3">
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
