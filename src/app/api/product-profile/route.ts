import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { getProductProfile, updateProductProfile } from "@/lib/data";

export const dynamic = "force-dynamic";

const list = z.array(z.string().trim().min(1).max(60)).max(30);
const schema = z
  .object({
    product_name: z.string().trim().min(2).max(80),
    one_liner: z.string().trim().min(10).max(200),
    description: z.string().trim().min(40, "Describe the product in at least a sentence or two").max(2000),
    target_languages: list,
    target_clouds: list,
    target_signals: list,
  })
  .partial()
  .strict();

export const GET = handler(async () => ok({ profile: await getProductProfile() }));
export const PUT = handler(async (req: Request) => ok({ profile: await updateProductProfile(schema.parse(await req.json())) }));
