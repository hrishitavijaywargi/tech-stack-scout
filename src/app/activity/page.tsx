import type { Metadata } from "next";
import Link from "next/link";
import { Activity } from "lucide-react";
import { LiveProgress } from "@/components/LiveProgress";
import { RetryJobButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, CardHeader, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { db, check } from "@/lib/supabase/server";
import { getSettings, recentJobs } from "@/lib/data";
import { formatDate, relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Research Activity" };

const TONE: Record<string, Tone> = { succeeded: "green", failed: "red", running: "indigo", queued: "blue", cancelled: "slate" };
const ERROR_HELP: Record<string, string> = {
  rate_limited: "An API rate limit was reached. The job waits for the reset and resumes automatically.",
  config: "A required API key is missing. Add it in the environment variables, then retry.",
  ai_validation: "Gemini's answer did not pass evidence checks three times. Retry usually succeeds.",
  ai_error: "The Gemini API returned an error (quota, overload or model id). Check Settings → connections.",
  timeout: "The research took longer than the time limit for one run. It is retried automatically.",
  source_error: "A public source could not be reached. Other sources are still used on retry.",
  permanent: "This job cannot succeed (for example the company was removed).",
};

function duration(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const s = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

async function load() {
  const [jobs, settings, batches] = await Promise.all([
    recentJobs(100),
    getSettings(),
    db().from("research_batches").select("id, label, total, created_at").order("created_at", { ascending: false }).limit(5).then((r) => check(r, "Loading batches")),
  ]);
  return { jobs, settings, batches: batches as { id: string; label: string; total: number; created_at: string }[] };
}

export default async function ActivityPage() {
  const res = await safeLoad(load);
  if (res.error !== null) {
    return (
      <>
        <PageHeader title="Research activity" />
        <SetupNotice error={res.error} />
      </>
    );
  }
  const { jobs, settings, batches } = res.data;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const ok = jobs.filter((j) => j.status === "succeeded").length;

  return (
    <>
      <PageHeader
        title="Research activity"
        description={
          <>
            {ok} succeeded · {failed} failed (last 100 jobs). Scheduler last ran {settings.last_scheduler_run_at ? `${relativeTime(settings.last_scheduler_run_at)} (${formatDate(settings.last_scheduler_run_at, true)})` : "never"}.
          </>
        }
      />
      <LiveProgress />

      {batches.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Recent batches" />
          <ul className="divide-y divide-slate-100 text-sm">
            {batches.map((b) => {
              const bj = jobs.filter((j) => j.batch_id === b.id);
              const done = bj.filter((j) => j.status === "succeeded").length;
              const bf = bj.filter((j) => j.status === "failed").length;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span className="text-slate-800">{b.label}</span>
                  <span className="text-xs text-slate-500">
                    {done} of {b.total} researched{bf ? ` · ${bf} failed` : ""} · {relativeTime(b.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Jobs" description="Every manual, bulk and scheduled run uses the same research pipeline. Failed jobs retry automatically (up to 3 attempts, exponential backoff)." />
        {jobs.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Attempts</th>
                  <th className="px-4 py-2.5 font-medium">Queued</th>
                  <th className="px-4 py-2.5 font-medium">Duration</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((j) => (
                  <tr key={j.id} className="align-top">
                    <td className="px-4 py-2.5">
                      {j.companies ? (
                        <Link href={`/companies/${j.company_id}`} className="font-medium text-slate-900 hover:text-indigo-700">
                          {j.companies.name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">Removed</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">{j.job_type}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={TONE[j.status] ?? "slate"}>{j.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-slate-600">
                      {j.attempts}/{j.max_attempts}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-600" title={formatDate(j.created_at, true)}>
                      {relativeTime(j.created_at)}
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums text-slate-600">{duration(j.started_at, j.completed_at)}</td>
                    <td className="max-w-sm px-4 py-2.5 text-xs">
                      {j.error_message ? (
                        <>
                          <p className={j.status === "failed" ? "text-red-700" : "text-amber-700"}>{j.error_message}</p>
                          {j.error_code && ERROR_HELP[j.error_code] && <p className="mt-0.5 text-slate-500">{ERROR_HELP[j.error_code]}</p>}
                        </>
                      ) : j.status === "queued" && Date.parse(j.run_after) > Date.now() ? (
                        <span className="text-slate-500">Scheduled to run {relativeTime(j.run_after)}</span>
                      ) : j.status === "succeeded" ? (
                        <span className="text-slate-500">Completed {formatDate(j.completed_at, true)}</span>
                      ) : null}
                      {j.status === "failed" && (
                        <div className="mt-1.5">
                          <RetryJobButton jobId={j.id} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Activity className="h-6 w-6" />} title="No research jobs yet" description="Jobs appear here when you add companies, press Research All, or the weekly schedule runs." />
        )}
      </Card>
    </>
  );
}
