import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/Toast";
import { THEME_SCRIPT } from "@/components/ThemeToggle";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Tech Stack Scout", template: "%s · Tech Stack Scout" },
  description: "Pre-call engineering intelligence for enterprise sales: public tech-stack evidence, Gemini summaries and outreach openings, refreshed weekly.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#4f46e5", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const gated = Boolean(process.env.APP_PASSWORD?.trim());
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">
        <ToastProvider>
          <Shell gated={gated}>{children}</Shell>
        </ToastProvider>
      </body>
    </html>
  );
}
