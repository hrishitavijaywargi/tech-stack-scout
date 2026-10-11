"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Activity, ListChecks, LogOut, Menu, Radar, Settings, X } from "lucide-react";
import { cx } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV = [
  { href: "/", label: "Watchlist", icon: ListChecks },
  { href: "/activity", label: "Research activity", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" || path.startsWith("/company") : path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors", active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-1">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Radar className="h-4 w-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight text-slate-900">Tech Stack Scout</span>
    </Link>
  );
}

function SignOut() {
  return (
    <form action="/api/auth/logout" method="post">
      <button type="submit" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Sign out" title="Sign out">
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );
}

export function Shell({ children, gated }: { children: ReactNode; gated: boolean }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  if (path === "/login") return <main id="main">{children}</main>;
  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:shadow">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-surface px-3 py-5 lg:flex">
        <Brand />
        <div className="mt-6">
          <NavLinks />
        </div>
        <div className="mt-auto space-y-3 px-1">
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {gated && <SignOut />}
          </div>
          <p className="px-2 text-xs leading-relaxed text-slate-400">Evidence from public sources only. AI: Gemini Flash.</p>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <div className="flex items-center">
          <ThemeToggle />
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Open navigation" aria-expanded={open}>
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-72 bg-surface p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            {gated && (
              <div className="mt-4">
                <SignOut />
              </div>
            )}
          </div>
        </div>
      )}

      <main id="main" className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
