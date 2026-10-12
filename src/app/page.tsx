import Link from "next/link";
import { Building2, CalendarClock, Clock, Flame, Gauge, Target } from "lucide-react";
import { AddCompaniesButton } from "@/components/AddCompaniesDialog";
import { LiveProgress } from "@/components/LiveProgress";
import { ExportButton, ResearchScopeButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Badge, Card, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { WatchlistTable } from "@/components/WatchlistTable";
import { formatDate, relativeTime } from "@/lib/format";
import { watchlistData } from "@/lib/views";

export const dynamic = "force-dynamic";

const RUN_TONE: Record<string, Tone> = { succeeded: "green", partial: "amber", failed: "red", running: "indigo", idle: "slate" };

function Stat({ label, value, hint, icon }: { label: string; value: string | number; hint?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">{icon}</span>
      <div className="min-w-0">
        <p className="text-xl font-semibold leading-tight tabular-nums text-slate-900">{value}</p>
        <p className="text-xs font-medium text-slate-600">{label}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}

export default async function WatchlistPage() {
  const res = await safeLoad(watchlistData);
  if (res.error !== null) {
    return (
      <>
        <PageHeader title="Accounts" />
        <SetupNotice error={res.error} />
      </>
    );
  }
  const { rows, lastRun, nextWeekly, nextDaily } = res.data;
  const stale = rows.filter((r) => r.stale).length;
  const hot = rows.filter((r) => r.whyNow).length;
  const strongFit = rows.filter((r) => (r.fitScore ?? 0) >= 80).length;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Walk into every call knowing how the account builds software — refreshed automatically each week."
        actions={
          <>
            {rows.length > 0 && <ExportButton />}
            {stale > 0 && <ResearchScopeButton scope="stale" label={`Refresh ${stale} stale`} icon="refresh" />}
            <AddCompaniesButton />
          </>
        }
      />

      <LiveProgress />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-6 w-6" />}
            title="Your watchlist is empty"
            description="Add a target account or upload a CSV. You can also insert rows into the Supabase companies table — they are picked up automatically within 10 minutes."
            action={<AddCompaniesButton />}
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Accounts" value={rows.length} hint={`${rows.length - stale} fresh`} icon={<Building2 className="h-4 w-4" />} />
            <Stat label="Reasons to reach out" value={hot} hint="new this week" icon={<Flame className="h-4 w-4" />} />
            <Stat label="Strong fit" value={strongFit} hint={`avg fit ${avg(rows.map((r) => r.fitScore)) ?? "—"}`} icon={<Target className="h-4 w-4" />} />
            <Stat label="Avg activity" value={avg(rows.map((r) => r.activityScore)) ?? "—"} hint="0–100" icon={<Gauge className="h-4 w-4" />} />
          </div>

          <WatchlistTable rows={rows} />

          <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-surface px-4 py-3 text-xs text-slate-600 lg:flex-row lg:items-center">
            <span className="flex flex-wrap items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              Last refresh run:{" "}
              {lastRun ? (
                <>
                  <Badge tone={RUN_TONE[lastRun.status] ?? "slate"}>{lastRun.status}</Badge>
                  <span title={formatDate(lastRun.started_at, true)}>
                    {relativeTime(lastRun.started_at)} · {lastRun.trigger}
                    {lastRun.source ? ` (${lastRun.source})` : ""} · {lastRun.companies_processed} processed
                    {lastRun.errors.length ? `, ${lastRun.errors.length} errors` : ""}
                  </span>
                </>
              ) : (
                "none yet"
              )}
            </span>
            <span className="flex items-center gap-1.5" title={`Weekly ${formatDate(nextWeekly, true)} · stale check ${formatDate(nextDaily, true)}`}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Next weekly refresh {relativeTime(nextWeekly)} (Mon 06:00 UTC) · stale check {relativeTime(nextDaily)}
            </span>
            <div className="flex items-center gap-3 lg:ml-auto">
              <ResearchScopeButton scope="all" label="Research all now" icon="play" />
              <Link href="/activity" className="font-medium text-indigo-700 hover:underline">
                Activity →
              </Link>
            </div>
          </div>
        </>
      )}
    </>
  );
}
