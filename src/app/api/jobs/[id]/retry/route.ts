import { z } from "zod";
import { fail, handler, ok, originOf, scheduleProcessing } from "@/lib/api";
import { retryJob } from "@/lib/data";

export const dynamic = "force-dynamic";

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const id = z.uuid().parse((await params).id);
  try {
    await retryJob(id);
  } catch (e) {
    return fail((e as Error).message, 409);
  }
  scheduleProcessing(originOf(req));
  return ok({ retried: id });
});
