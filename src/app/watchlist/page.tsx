import type { Metadata } from "next";
import { ListChecks } from "lucide-react";
import { AddCompaniesButton } from "@/components/AddCompaniesDialog";
import { LiveProgress } from "@/components/LiveProgress";
import { ExportButton, ResearchAllButton } from "@/components/ResearchActions";
import { SetupNotice, safeLoad } from "@/components/SetupNotice";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { WatchlistTable } from "@/components/WatchlistTable";
import { watchlistRows } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  const res = await safeLoad(watchlistRows);
  if (res.error !== null) {
    return (
      <>
        <PageHeader title="Company watchlist" />
        <SetupNotice error={res.error} />
      </>
    );
  }
  const { rows } = res.data;
  return (
    <>
      <PageHeader
        title="Company watchlist"
        description={`${rows.length} target ${rows.length === 1 ? "account" : "accounts"}. Add or remove companies at any time — no code changes needed.`}
        actions={
          <>
            {rows.length > 0 && <ExportButton />}
            <AddCompaniesButton variant={rows.length ? "secondary" : "primary"} />
            {rows.length > 0 && <ResearchAllButton />}
          </>
        }
      />
      <LiveProgress />
      <Card>
        {rows.length ? (
          <WatchlistTable rows={rows} />
        ) : (
          <EmptyState icon={<ListChecks className="h-6 w-6" />} title="No companies yet" description="Add a company or upload a CSV to start building engineering context." action={<AddCompaniesButton />} />
        )}
      </Card>
    </>
  );
}
