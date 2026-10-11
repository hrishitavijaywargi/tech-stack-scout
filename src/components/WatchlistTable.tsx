"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, ChevronsUpDown, Minus, Search } from "lucide-react";
import { Badge, StatusBadge, cx } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { RefreshCompanyButton, RemoveCompanyButton } from "@/components/ResearchActions";
import { formatDate, relativeTime } from "@/lib/format";
import type { WatchlistRow } from "@/lib/views";

type SortKey = "name" | "fit" | "activity" | "roles" | "refreshed";

export function ScoreCell({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-xs text-slate-400">—</span>;
  const tone = value >= 70 ? "bg-emerald-500" : value >= 40 ? "bg-amber-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value}/100`}>
      <span className="w-7 text-right text-sm font-semibold tabular-nums text-slate-900">{value}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200" aria-hidden>
        <span className={cx("block h-full rounded-full", tone)} style={{ width: `${value}%` }} />
      </span>
    </div>
  );
}

export function LanguageChips({ languages }: { languages: WatchlistRow["languages"] }) {
  if (!languages.length) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {languages.map((l) => (
        <span key={l.name} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700" title={`${l.pct}% of recently active code`}>
          <span className="h-2 w-2 rounded-full" style={{ background: l.color ?? "rgb(var(--slate-400))" }} aria-hidden />
          {l.name}
        </span>
      ))}
    </div>
  );
}

function RolesCell({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null) return <span className="text-xs text-slate-400">—</span>;
  const d = prev === null ? null : now - prev;
  const Icon = d === null || d === 0 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1 text-sm tabular-nums text-slate-900" title={prev === null ? "No previous snapshot" : `Previous snapshot: ${prev}`}>
      {now}
      <Icon className={cx("h-3.5 w-3.5", d === null || d === 0 ? "text-slate-400" : d > 0 ? "text-emerald-600" : "text-red-600")} aria-label={d === null ? "no trend yet" : d > 0 ? `up ${d}` : d < 0 ? `down ${-d}` : "unchanged"} />
    </span>
  );
}

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const [q, setQ] = useState("");
  const [cloud, setCloud] = useState("all");
  const [lang, setLang] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "fit", dir: -1 });

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
        const d = sort.dir;
        switch (sort.key) {
          case "name":
            return a.name.localeCompare(b.name) * d;
          case "fit":
            return (num(a.fitScore) - num(b.fitScore)) * d || a.name.localeCompare(b.name);
          case "activity":
            return (num(a.activityScore) - num(b.activityScore)) * d || a.name.localeCompare(b.name);
          case "roles":
            return (num(a.engRoles) - num(b.engRoles)) * d || a.name.localeCompare(b.name);
          case "refreshed":
            return (Date.parse(a.lastRefreshed ?? "0") - Date.parse(b.lastRefreshed ?? "0")) * d;
        }
      });
  }, [rows, q, cloud, lang, sort]);

  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={cx("px-3 py-2.5 font-medium", className)} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : key === "name" ? 1 : -1 }))}>
          {label}
          <Icon className="h-3 w-3" aria-hidden />
        </button>
      </th>
    );
  };
  const select = "rounded-lg border border-slate-300 bg-surface py-2 pl-3 pr-8 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 md:flex-row md:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Search companies</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company, domain, language or cloud…"
            className="w-full rounded-lg border border-slate-300 bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <div className="flex gap-2">
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
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {header("name", "Company", "pl-4")}
              <th scope="col" className="px-3 py-2.5 font-medium">
                Top languages
              </th>
              <th scope="col" className="px-3 py-2.5 font-medium">
                Cloud
              </th>
              {header("activity", "Activity")}
              {header("fit", "Fit")}
              {header("roles", "Eng roles")}
              {header("refreshed", "Refreshed")}
              <th scope="col" className="px-3 py-2.5 pr-4 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => (
              <tr key={r.id} className="align-middle hover:bg-slate-50/60">
                <td className="py-3 pl-4 pr-3">
                  <Link href={`/company/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                    {r.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {r.domain}
                    {r.status !== "completed" && <StatusBadge status={r.status} />}
                    {r.githubUnconfirmed && (
                      <Badge tone="amber" title="GitHub organization matched by name only">
                        GitHub unconfirmed
                      </Badge>
                    )}
                  </div>
                  {r.status === "failed" && r.lastError && <p className="mt-1 max-w-[16rem] text-xs text-red-700">{r.lastError}</p>}
                </td>
                <td className="px-3 py-3">
                  <LanguageChips languages={r.languages} />
                </td>
                <td className="px-3 py-3 text-sm text-slate-700">{r.primaryCloud ?? <span className="text-xs text-slate-400">—</span>}</td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <ScoreCell value={r.activityScore} label="Activity score" />
                    <Sparkline values={r.commits52w} className="hidden xl:block" />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ScoreCell value={r.fitScore} label="Product fit" />
                </td>
                <td className="px-3 py-3">
                  <RolesCell now={r.engRoles} prev={r.prevEngRoles} />
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-xs text-slate-600">
                  <div title={formatDate(r.lastRefreshed, true)} className="flex items-center gap-1">
                    {r.stale && r.lastRefreshed && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-label="Stale: older than 7 days" />}
                    {r.lastRefreshed ? relativeTime(r.lastRefreshed) : "never"}
                  </div>
                  {r.nextRefresh && <div className="text-slate-400">next {relativeTime(r.nextRefresh)}</div>}
                </td>
                <td className="py-3 pl-3 pr-4">
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/company/${r.id}`} className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                      Brief
                    </Link>
                    <RefreshCompanyButton id={r.id} size="sm" status={r.status} />
                    <RemoveCompanyButton id={r.id} name={r.name} size="sm" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && <p className="px-4 py-10 text-center text-sm text-slate-500">No companies match your filters.</p>}
      </div>
    </div>
  );
}
