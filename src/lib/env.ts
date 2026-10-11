import "server-only";
import { z } from "zod";

/**
 * Server-side environment validation. Required values are checked lazily the first time
 * they are needed so pages can still render a helpful "not configured" state instead of
 * crashing the whole build.
 */
const schema = z.object({
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  GEMINI_API_KEY: z.string().min(10).optional(),
  GEMINI_MODEL: z.string().min(3).default("gemini-3.8-flash"),
  GITHUB_TOKEN: z.string().min(10).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  BASIC_AUTH_USER: z.string().optional(),
  BASIC_AUTH_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function blankToUndefined(v: string | undefined) {
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const raw = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, blankToUndefined(process.env[k])]));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    // Never echo values — only which variable is invalid.
    throw new Error(`Invalid environment configuration: ${issues}`);
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
    github: Boolean(e.GITHUB_TOKEN),
    cronSecret: Boolean(e.CRON_SECRET),
    basicAuth: Boolean(e.BASIC_AUTH_USER && e.BASIC_AUTH_PASSWORD),
  };
}
