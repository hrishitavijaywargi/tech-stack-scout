import "server-only";
import { z } from "zod";

/**
 * Server-side environment validation. Required values are checked lazily the first time they
 * are needed, so pages can render a helpful "not configured" state instead of crashing.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? true : !/^(0|false|off|no)$/i.test(v)));

const schema = z.object({
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().min(3).default("gemini-3.6-flash"),
  // Used only when the primary Flash model is overloaded (429/5xx) or out of quota.
  GEMINI_FALLBACK_MODEL: z.string().min(3).default("gemini-3.8-flash"),
  WEB_RESEARCH_ENABLED: bool,
  GITHUB_TOKEN: z.string().min(10).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  APP_PASSWORD: z.string().min(6).optional(),
});

export type Env = z.infer<typeof schema>;

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const raw: Record<string, string | undefined> = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, blank(process.env[k])]));
  // The spec's NEXT_PUBLIC_SUPABASE_URL is accepted as an alias.
  raw.SUPABASE_URL ??= blank(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Never echo values — only which variable is invalid.
    throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  cached = parsed.data;
  return cached;
}

export class ConfigError extends Error {
  constructor(public variable: string) {
    super(`${variable} is not configured. Add it to .env.local (local) or Vercel environment variables.`);
    this.name = "ConfigError";
  }
}

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const v = env()[key];
  if (v === undefined || v === null || v === "") throw new ConfigError(key);
  return v as NonNullable<Env[K]>;
}

/** Non-secret summary for the Settings page. */
export function configStatus() {
  const e = env();
  return {
    supabase: Boolean(e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY),
    gemini: Boolean(e.GEMINI_API_KEY),
    geminiModel: e.GEMINI_MODEL,
    geminiFallbackModel: e.GEMINI_FALLBACK_MODEL,
    webResearch: e.WEB_RESEARCH_ENABLED,
    github: Boolean(e.GITHUB_TOKEN),
    cronSecret: Boolean(e.CRON_SECRET),
    passwordGate: Boolean(e.APP_PASSWORD),
  };
}
