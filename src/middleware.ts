import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

/**
 * Password gate: when APP_PASSWORD is set, every page and API route needs the session cookie.
 * The scheduler (/api/cron/*) authenticates with CRON_SECRET instead.
 */
export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD?.trim();
  if (!password) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/")) return NextResponse.next();

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
