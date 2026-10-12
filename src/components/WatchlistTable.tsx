"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Cloud, LayoutGrid, List, Minus, Search, Sparkles } from "lucide-react";
import { Badge, StatusBadge, cx } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { CompanyLogo, ScoreRing } from "@/components/Cockpit";
import { CopyButton, RefreshCompanyButton, RemoveCompanyButton } from "@/components/ResearchActions";
import { formatDate, relativeTime } from "@/lib/format";
import type { WatchlistRow } from "@/lib/views";

type SortKey = "hot" | "fit" | "activity" | "roles" | "name" | "refreshed";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "hot", label: "Hottest first" },
  { key: "fit", label: "Product fit" },
  { key: "activity", label: "Activity" },
  { key: "roles", label: "Eng hiring" },
  { key: "refreshed", label: "Recently refreshed" },
  { key: "name", label: "Name" },
];

export function LanguageChips({ languages }: { languages: WatchlistRow["languages"] }) {
  if (!languages.length) return null;
  return (
    <>
      {languages.map((l) => (
        <span key={l.name} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={`${l.pct}% of recently active code`}>
          <span className="h-2 w-2 rounded-full" style={{ background: l.color ?? "rgb(var(--slate-400))" }} aria-hidden />
          {l.name}
        </span>
      ))}
    </>
  );
}

function RolesChip({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null) return null;
  const d = prev === null ? null : now - prev;
  const Icon = d === null || d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={prev === null ? "No previous snapshot" : `Previous snapshot: ${prev}`}>
      {now} eng roles
      <Icon className={cx("h-3 w-3", d === null || d === 0 ? "text-slate-400" : d > 0 ? "text-emerald-600" : "text-red-600")} aria-label={d === null ? "no trend yet" : d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : "unchanged"} />
    </span>
  );
}

function hotness(r: WatchlistRow) {
  return (r.whyNow ? 1000 : 0) + (r.fitScore ?? 0) * 2 + (r.activityScore ?? 0);
}

function AccountCard({ r }: { r: WatchlistRow }) {
  return (
    <article className={cx("group relative flex flex-col rounded-2xl border bg-surface p-4 shadow-sm shadow-black/5 transition-colors hover:border-indigo-300", r.whyNow ? "border-indigo-200" : "border-slate-200")}>
      <div className="flex items-start gap-3">
        <CompanyLogo name={r.name} domain={r.domain} githubOrg={r.githubLogin} size={40} />
        <div className="min-w-0 flex-1">
          <Link href={`/company/${r.id}`} className="block truncate text-[15px] font-semibold text-slate-900 after:absolute after:inset-0 after:rounded-2xl hover:text-indigo-700">
            {r.name}
          </Link>
          <p className="truncate text-xs text-slate-500">{r.domain}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <ScoreRing value={r.fitScore} label="Fit" size={42} />
          <ScoreRing value={r.activityScore} label="Activity" size={42} />
        </div>
      </div>

      {r.whyNow && (
        <div className="relative mt-3 flex items-start gap-2 rounded-lg bg-indigo-50 px-2.5 py-1.5 text-xs text-indigo-800">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-semibold">New reason to reach out:</span> {r.whyNow.title}
            {r.whyNow.count > 1 && <span className="text-indigo-600"> · +{r.whyNow.count - 1} more</span>}
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        <LanguageChips languages={r.languages} />
        {r.primaryCloud && (
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
            <Cloud className="h-3 w-3 text-slate-500" aria-hidden />
            {r.primaryCloud}
          </span>
        )}
        <RolesChip now={r.engRoles} prev={r.prevEngRoles} />
        {r.status !== "completed" && <StatusBadge status={r.status} />}
        {r.githubUnconfirmed && <Badge tone="amber">GitHub unconfirmed</Badge>}
      </div>

      <div className="mt-3 flex-1">
        {r.outreachLine ? (
          <blockquote className="line-clamp-4 border-l-2 border-indigo-500 pl-3 text-sm leading-relaxed text-slate-800">{r.outreachLine}</blockquote>
        ) : (
          <p className="text-sm italic text-slate-400">{r.status === "failed" ? (r.lastError ?? "Research failed") : r.lastRefreshed ? "No opener yet — not enough evidence." : "Not researched yet."}</p>
        )}
      </div>

      <div className="relative z-10 mt-4 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="flex items-center gap-1 text-xs text-slate-500" title={formatDate(r.lastRefreshed, true)}>
          {r.stale && r.lastRefreshed && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Stale: older than 7 days" />}
          {r.lastRefreshed ? `Refreshed ${relativeTime(r.lastRefreshed)}` : "Never refreshed"}
        </span>
        <div className="flex items-center gap-1.5">
          {r.outreachLine && <CopyButton text={r.outreachLine} label="Copy opener" />}
          <RefreshCompanyButton id={r.id} size="sm" status={r.status} />
          <RemoveCompanyButton id={r.id} name={r.name} size="sm" />
        </div>
      </div>
    </article>
  );
}

function AccountTable({ rows }: { rows: WatchlistRow[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-surface">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="py-2.5 pl-4 pr-3 font-medium">Company</th>
            <th className="px-3 py-2.5 font-medium">Top languages</th>
            <th className="px-3 py-2.5 font-medium">Cloud</th>
            <th className="px-3 py-2.5 font-medium">Activity</th>
            <th className="px-3 py-2.5 font-medium">Fit</th>
            <th className="px-3 py-2.5 font-medium">Eng roles</th>
            <th className="px-3 py-2.5 font-medium">Refreshed</th>
            <th className="py-2.5 pl-3 pr-4 text-right font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id} className="align-middle hover:bg-slate-50/60">
              <td className="py-2.5 pl-4 pr-3">
                <div className="flex items-center gap-2.5">
                  <CompanyLogo name={r.name} domain={r.domain} githubOrg={r.githubLogin} size={28} />
                  <div className="min-w-0">
                    <Link href={`/company/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                      {r.name}
                    </Link>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      {r.domain}
                      {r.whyNow && <Sparkles className="h-3 w-3 text-indigo-600" aria-label="New reason to reach out" />}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  <LanguageChips languages={r.languages} />
                </div>
              </td>
              <td className="px-3 py-2.5 text-slate-700">{r.primaryCloud ?? <span className="text-slate-400">—</span>}</td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-7 text-right font-semibold tabular-nums text-slate-900">{r.activityScore ?? "—"}</span>
                  <Sparkline values={r.commits52w} className="hidden xl:block" />
                </div>
              </td>
              <td className="px-3 py-2.5 font-semibold tabular-nums text-slate-900">{r.fitScore ?? "—"}</td>
              <td className="px-3 py-2.5">
                <RolesChip now={r.engRoles} prev={r.prevEngRoles} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-xs text-slate-600">
                <span className="flex items-center gap-1">
                  {r.stale && r.lastRefreshed && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Stale" />}
                  {r.lastRefreshed ? relativeTime(r.lastRefreshed) : "never"}
                </span>
              </td>
              <td className="py-2.5 pl-3 pr-4">
                <div className="flex justify-end gap-1.5">
                  <RefreshCompanyButton id={r.id} size="sm" status={r.status} />
                  <RemoveCompanyButton id={r.id} name={r.name} size="sm" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const [q, setQ] = useState("");
  const [cloud, setCloud] = useState("all");
  const [lang, setLang] = useState("all");
  const [sort, setSort] = useState<SortKey>("hot");
  const [view, setView] = useState<"cards" | "table">("cards");

  useEffect(() => {
    try {
      const v = localStorage.getItem("tss-view");
      if (v === "table" || v === "cards") setView(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeView = (v: "cards" | "table") => {
    setView(v);
    try {
      localStorage.setItem("tss-view", v);
    } catch {
      /* storage unavailable */
    }
  };

  const clouds = useMemo(() => [...new Set(rows.flatMap((r) => r.clouds))].sort(), [rows]);
  const langs = useMemo(() => [...new Set(rows.flatMap((r) => r.languages.map((l) => l.name)))].sort(), [rows]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const num = (v: number | null) => v ?? -1;
    return rows
      .filter((r) => cloud === "all" || r.clouds.includes(cloud))
      .filter((r) => lang === "all" || r.languages.some((l) => l.name === lang))
      .filter((r) => !needle || [r.name, r.domain, ...r.languages.map((l) => l.name), ...r.clouds].some((v) => v.toLowerCase().includes(needle)))
      .sort((a, b) => {
        switch (sort) {
          case "hot":
            return hotness(b) - hotness(a);
          case "fit":
            return num(b.fitScore) - num(a.fitScore) || a.name.localeCompare(b.name);
          case "activity":
            return num(b.activityScore) - num(a.activityScore) || a.name.localeCompare(b.name);
          case "roles":
            return num(b.engRoles) - num(a.engRoles) || a.name.localeCompare(b.name);
          case "refreshed":
            return Date.parse(b.lastRefreshed ?? "0") - Date.parse(a.lastRefreshed ?? "0");
          case "name":
            return a.name.localeCompare(b.name);
        }
      });
  }, [rows, q, cloud, lang, sort]);

  const select = "rounded-lg border border-slate-200 bg-surface py-2 pl-3 pr-8 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-[220px] flex-1">
          <span className="sr-only">Search accounts</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search accounts, languages, clouds…"
            className="w-full rounded-lg border border-slate-200 bg-surface py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <label>
            <span className="sr-only">Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={select}>
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by cloud</span>
            <select value={cloud} onChange={(e) => setCloud(e.target.value)} className={select}>
              <option value="all">All clouds</option>
              {clouds.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Filter by language</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className={select}>
              <option value="all">All languages</option>
              {langs.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <div role="group" aria-label="View" className="flex rounded-lg border border-slate-200 bg-surface p-0.5">
            {(["cards", "table"] as const).map((v) => {
              const Icon = v === "cards" ? LayoutGrid : List;
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={cx("rounded-md p-1.5", view === v ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-900")}
                  aria-label={v === "cards" ? "Card view" : "Table view"}
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {!visible.length ? (
        <p className="rounded-2xl border border-slate-200 bg-surface px-4 py-10 text-center text-sm text-slate-500">No accounts match your filters.</p>
      ) : view === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((r) => (
            <AccountCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <AccountTable rows={visible} />
      )}
      <p className="mt-3 flex items-center gap-1 text-xs text-slate-500">
        <ArrowRight className="h-3 w-3" aria-hidden /> Open an account for its full pre-call brief.
      </p>
    </div>
  );
}
