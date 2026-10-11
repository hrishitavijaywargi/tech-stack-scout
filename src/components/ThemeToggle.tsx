"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Inline script (in <head>) that applies the saved theme, or the OS preference, before paint. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("tss-theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d)}catch(e){}})();`;

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  if (dark === null) return <span className="h-8 w-8" aria-hidden />;
  return (
    <button
      type="button"
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("tss-theme", next ? "dark" : "light");
        } catch {
          /* storage unavailable: theme still applies for this page */
        }
        setDark(next);
      }}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
