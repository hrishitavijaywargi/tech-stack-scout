import { NextResponse, type NextRequest } from "next/server";

/** Optional HTTP Basic Auth for the whole app (set BASIC_AUTH_USER + BASIC_AUTH_PASSWORD). */
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();
  // The scheduler authenticates with CRON_SECRET instead.
  if (req.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const i = decoded.indexOf(":");
    if (decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Tech Stack Scout"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
