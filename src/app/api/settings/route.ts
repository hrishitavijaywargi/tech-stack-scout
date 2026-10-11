import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/data";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    refresh_interval_days: z.number().int().min(1).max(60),
    max_repos: z.number().int().min(3).max(25),
    include_job_boards: z.boolean(),
    include_blogs: z.boolean(),
    include_hacker_news: z.boolean(),
  })
  .partial()
  .strict();

export const GET = handler(async () => ok({ settings: await getSettings() }));
export const PUT = handler(async (req: Request) => ok({ settings: await updateSettings(schema.parse(await req.json())) }));
