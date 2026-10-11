/**
 * Password gate (APP_PASSWORD). The session cookie holds an HMAC of a fixed label keyed by the
 * password, so it can be verified without storing sessions and changes when the password does.
 * Web Crypto only — runs in middleware (edge) and route handlers.
 */
export const SESSION_COOKIE = "tss_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function sessionToken(password: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("tech-stack-scout/session/v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
