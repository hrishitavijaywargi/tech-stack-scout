import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, safeNext, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Form POST from /login. Sets an httpOnly session cookie when the password matches. */
export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/"));
  const expected = process.env.APP_PASSWORD?.trim();
  const base = new URL(req.url);

  if (!expected) return NextResponse.redirect(new URL(next, base), 303);
  if (!safeEqual(password, expected)) {
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    return NextResponse.redirect(new URL(`/login?error=1&next=${encodeURIComponent(next)}`, base), 303);
  }
  const res = NextResponse.redirect(new URL(next, base), 303);
  res.cookies.set(SESSION_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: base.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
