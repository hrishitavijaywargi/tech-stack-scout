import { handler, ok } from "@/lib/api";
import { db, check } from "@/lib/supabase/server";
import { queueProgress } from "@/lib/data";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const [progress, companies] = await Promise.all([
    queueProgress(),
    db()
      .from("companies")
      .select("id, research_status, last_researched_at, next_refresh_at, last_error")
      .then((r) => check(r, "Loading statuses")),
  ]);
  return ok({ ...progress, companies });
});
