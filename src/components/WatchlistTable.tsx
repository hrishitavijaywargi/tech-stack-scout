"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { Badge, ConfidenceBadge, StatusBadge, cx } from "@/components/ui";
import { RefreshCompanyButton, RemoveCompanyButton } from "@/components/ResearchActions";
import { formatDate, relativeTime } from "@/lib/format";
import type { ResearchStatus } from "@/lib/types";

export interface WatchlistRow {
  id: string;
  name: string;
  domain: string | null;
  status: ResearchStatus;
  keyTech: string[];
  lastResearchedAt: string | null;
  nextRefreshAt: string | null;
  confidence: "High" | "Medium" | "Low" | null;
  lastError: string | null;
  githubOrg: string | null;
  githubUnconfirmed: boolean;
  paused: boolean;
}

type SortKey = "name" | "status" | "lastResearchedAt" | "confidence";
const STATUS_ORDER: ResearchStatus[] = ["failed", "researching", "queued", "not_started", "completed"];
const CONF_ORDER = { High: 3, Medium: 2, Low: 1 } as const;

export function WatchlistTable({ rows }: { rows: WatchlistRow[] }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ResearchStatus | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => status === "all" || r.status === status)
      .filter((r) => !needle || [r.name, r.domain ?? "", r.githubOrg ?? "", ...r.keyTech].some((v) => v.toLowerCase().includes(needle)))
      .sort((a, b) => {
        const d = sort.dir;
        switch (sort.key) {
          case "name":
            return a.name.localeCompare(b.name) * d;
          case "status":
            return (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * d;
          case "lastResearchedAt":
            return (Date.parse(a.lastResearchedAt ?? "0") - Date.parse(b.lastResearchedAt ?? "0")) * d;
          case "confidence":
            return ((a.confidence ? CONF_ORDER[a.confidence] : 0) - (b.confidence ? CONF_ORDER[b.confidence] : 0)) * d;
        }
      });
  }, [rows, q, status, sort]);

  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    const Icon = !active ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={cx("px-4 py-2.5 font-medium", className)} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((s.dir * -1) as 1 | -1) : 1 }))}>
          {label}
          <Icon className="h-3 w-3" aria-hidden />
        </button>
      </th>
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Search companies</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by company, domain or technology…"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <span className="sr-only sm:not-sr-only">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ResearchStatus | "all")}
            className="rounded-lg border border-slate-300 py-2 pl-3 pr-8 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="all">All statuses</option>
            <option value="completed">Completed</option>
            <option value="researching">Researching</option>
            <option value="queued">Queued</option>
            <option value="not_started">Not Started</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {header("name", "Company")}
              {header("status", "Status")}
              <th scope="col" className="px-4 py-2.5 font-medium">
                Key technologies
              </th>
              {header("confidence", "Confidence", "hidden md:table-cell")}
              {header("lastResearchedAt", "Last researched")}
              <th scope="col" className="px-4 py-2.5 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((r) => (
              <tr key={r.id} className="align-top hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link href={`/companies/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                    {r.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {r.domain ?? <span className="italic">no website</span>}
                    {r.githubUnconfirmed && (
                      <Badge tone="amber" title="GitHub organization matched by name only">
                        GitHub unconfirmed
                      </Badge>
                    )}
                    {r.paused && <Badge>Paused</Badge>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                  {r.status === "failed" && r.lastError && <p className="mt-1 max-w-[16rem] text-xs text-red-700">{r.lastError}</p>}
                </td>
                <td className="px-4 py-3">
                  {r.keyTech.length ? (
                    <div className="flex max-w-xs flex-wrap gap-1">
                      {r.keyTech.slice(0, 6).map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-400">{r.lastResearchedAt ? "Not publicly found" : "—"}</span>
                  )}
                </td>
                <td className="hidden px-4 py-3 md:table-cell">{r.confidence ? <ConfidenceBadge level={r.confidence} /> : <span className="text-xs text-slate-400">—</span>}</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                  <div title={formatDate(r.lastResearchedAt, true)}>{relativeTime(r.lastResearchedAt)}</div>
                  {r.nextRefreshAt && <div className="text-slate-400">next {relativeTime(r.nextRefreshAt)}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <Link href={`/companies/${r.id}`} className="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-medium text-indigo-700 hover:bg-indigo-50">
                      Open
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
