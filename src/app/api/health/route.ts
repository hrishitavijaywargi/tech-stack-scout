import { handler, ok } from "@/lib/api";
import { getConnectionStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

/** Connection status without secrets. */
export const GET = handler(async () => ok(await getConnectionStatus()));
