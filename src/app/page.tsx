import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, Clock, Sparkles } from "lucide-react";
import { AddCompaniesButton } from "@/components/AddCompaniesDialog";
import { LiveProgress } from "@/components/LiveProgress";
import { ExportButton, ResearchAllButton, ResearchNeedsAttentionButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge, type Tone } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { dashboardData } from "@/lib/views";
import type { ResearchStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const JOB_TONE: Record<string, Tone> = { succeeded: "green", failed: "red", running: "indigo", queued: "blue", cancelled: "slate" };

function Stat({ label, value, icon, hint, href }: { label: string; value: number | string; icon: React.ReactNode; hint?: string; href?: string }) {
  const body = (
    <Card className="h-full p-4 transition-colors hover:border-slate-300">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default async function DashboardPage() {
  const res = await safeLoad(dashboardData);
  if (res.error !== null) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <SetupNotice error={res.error} />
      </>
    );
  }
  const { rows, jobs, changes, avgMs, measuredJobs } = res.data;
  const completed = rows.filter((r) => r.status === "completed").length;
  const attention = rows.filter((r) => r.status === "failed" || r.status === "not_started" || r.githubUnconfirmed);
  const inFlight = rows.filter((r) => r.status === "queued" || r.status === "researching").length;
  const needsResearch = rows.filter((r) => r.status === "failed" || r.status === "not_started").length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Engineering context for every account on your watchlist, refreshed automatically each week."
        actions={
          <>
            {rows.length > 0 && <ExportButton />}
            <AddCompaniesButton variant={rows.length ? "secondary" : "primary"} />
            {rows.length > 0 && <ResearchAllButton />}
          </>
        }
      />
      <LiveProgress />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Your watchlist is empty"
            description="Add a target account, or upload a CSV of your sprint list. Each company is researched from public GitHub code, job postings and engineering articles, then summarised by Gemini."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <AddCompaniesButton />
                <AddCompaniesButton variant="secondary" initialTab="csv" />
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Companies" value={rows.length} icon={<Building2 className="h-4 w-4" />} hint="on the watchlist" href="/watchlist" />
            <Stat label="Researched" value={completed} icon={<CheckCircle2 className="h-4 w-4" />} hint={`${rows.length ? Math.round((completed / rows.length) * 100) : 0}% with a current report`} />
            <Stat label="Needs attention" value={attention.length} icon={<AlertTriangle className="h-4 w-4" />} hint="failed, not started or unconfirmed GitHub" />
            <Stat
              label="Avg. research time"
              value={avgMs ? `${Math.round(avgMs / 1000)}s` : "—"}
              icon={<Clock className="h-4 w-4" />}
              hint={avgMs ? `per company, measured over ${measuredJobs} runs` : inFlight ? "measuring…" : "no completed runs yet"}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="What's changed" description="New signals from the latest refreshes — fresh reasons to reach out." />
              {changes.length ? (
                <ul className="divide-y divide-slate-100">
                  {changes.map((c, i) => (
                    <li key={i} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/companies/${c.companyId}`} className="text-xs font-medium text-indigo-700 hover:underline">
                            {c.companyName}
                          </Link>
                          <p className="text-sm text-slate-800">{c.title}</p>
                        </div>
                        <span className="shrink-0 text-xs text-slate-400">{relativeTime(c.snapshotAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No changes yet" description="Changes appear after a company has been researched at least twice (e.g. after the weekly refresh)." />
              )}
            </Card>

            <Card>
              <CardHeader
                title="Latest refresh activity"
                actions={
                  <Link href="/activity" className="text-xs font-medium text-indigo-700 hover:underline">
                    View all
                  </Link>
                }
              />
              {jobs.length ? (
                <ul className="divide-y divide-slate-100">
                  {jobs.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <div className="min-w-0">
                        <Link href={`/companies/${j.company_id}`} className="truncate text-sm font-medium text-slate-800 hover:text-indigo-700">
                          {j.companies?.name ?? "Removed company"}
                        </Link>
                        <p className="truncate text-xs text-slate-500">
                          {j.job_type} · {relativeTime(j.completed_at ?? j.created_at)}
                          {j.status === "failed" && j.error_message ? ` · ${j.error_message}` : ""}
                        </p>
                      </div>
                      <Badge tone={JOB_TONE[j.status] ?? "slate"}>{j.status}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No research has run yet" description="Use Research All to start." />
              )}
            </Card>
          </div>

          {attention.length > 0 && (
            <Card className="mt-6">
              <CardHeader title="Needs attention" description="Failed or not-yet-researched accounts, and GitHub matches you should confirm." actions={<ResearchNeedsAttentionButton count={needsResearch} />} />
              <ul className="divide-y divide-slate-100">
                {attention.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <Link href={`/companies/${r.id}`} className="text-sm font-medium text-slate-900 hover:text-indigo-700">
                        {r.name}
                      </Link>
                      <p className="text-xs text-slate-500">
                        {r.status === "failed"
                          ? r.lastError
                          : r.status === "not_started"
                            ? "Not researched yet"
                            : `GitHub organization "${r.githubOrg}" matched by name only — open the report to confirm it`}
                      </p>
                    </div>
                    <StatusBadge status={r.status as ResearchStatus} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}
