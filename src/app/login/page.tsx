import type { Metadata } from "next";
import { Radar } from "lucide-react";
import { safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form action="/api/auth/login" method="post" className="w-full max-w-sm rounded-2xl border border-slate-200 bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Radar className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-base font-semibold text-slate-900">Tech Stack Scout</h1>
            <p className="text-xs text-slate-500">Engineering intelligence for sales</p>
          </div>
        </div>
        <input type="hidden" name="next" value={safeNext(next)} />
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            type="password"
            name="password"
            required
            autoFocus
            autoComplete="current-password"
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-surface px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Incorrect password.
          </p>
        )}
        <button type="submit" className="mt-4 h-10 w-full rounded-lg bg-indigo-600 text-sm font-medium text-white shadow-sm hover:bg-indigo-700">
          Sign in
        </button>
        <p className="mt-3 text-center text-xs text-slate-500">Password protection is enabled by the APP_PASSWORD setting.</p>
      </form>
    </div>
  );
}
