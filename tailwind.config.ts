import type { Config } from "tailwindcss";

/**
 * Colours used by the app are CSS variables (see globals.css), so the whole UI switches to dark
 * mode by swapping variable values — no per-component dark: classes needed.
 */
const scale = (name: string, steps: number[]) => Object.fromEntries(steps.map((s) => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        slate: scale("slate", STEPS),
        indigo: scale("indigo", STEPS),
        emerald: scale("emerald", STEPS),
        amber: scale("amber", STEPS),
        red: scale("red", STEPS),
        sky: scale("sky", STEPS),
      },
    },
  },
  plugins: [],
} satisfies Config;
