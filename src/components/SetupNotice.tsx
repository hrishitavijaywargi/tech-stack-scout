import { Card, Notice } from "@/components/ui";

/** Shown instead of a page when the database is not configured or unreachable. */
export function SetupNotice({ error }: { error: string }) {
  const notConfigured = /not configured/i.test(error);
  const missingTables = /relation .* does not exist|Could not find the table|schema cache/i.test(error);
  return (
    <Card className="p-5">
      <Notice tone={notConfigured || missingTables ? "amber" : "red"} title={notConfigured ? "Setup required" : missingTables ? "Database migrations not applied" : "Could not load data"}>
        <p>{error}</p>
        {notConfigured && <p className="mt-2">Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see README → Setup), then reload.</p>}
        {missingTables && <p className="mt-2">Run the SQL files in supabase/migrations against your Supabase project (README → Database).</p>}
      </Notice>
    </Card>
  );
}

export async function safeLoad<T>(fn: () => Promise<T>): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await fn(), error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}
