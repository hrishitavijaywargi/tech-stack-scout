/** Seed watchlist. Verified with `npx tsx scripts/verify-seed.ts` before being written to supabase/seed.sql. */
export interface SeedCompany {
  name: string;
  domain: string;
  github_org: string | null;
  job_board_provider: "greenhouse" | "lever" | "ashby" | null;
  job_board_slug: string | null;
  blog_rss_url: string | null;
}

export const SEED_COMPANIES: SeedCompany[] = [
  { name: "Stripe", domain: "stripe.com", github_org: "stripe", job_board_provider: "greenhouse", job_board_slug: "stripe", blog_rss_url: null },
  { name: "Cloudflare", domain: "cloudflare.com", github_org: "cloudflare", job_board_provider: "greenhouse", job_board_slug: "cloudflare", blog_rss_url: "https://blog.cloudflare.com/rss/" },
  { name: "Datadog", domain: "datadoghq.com", github_org: "DataDog", job_board_provider: "greenhouse", job_board_slug: "datadog", blog_rss_url: null },
  { name: "Discord", domain: "discord.com", github_org: "discord", job_board_provider: "greenhouse", job_board_slug: "discord", blog_rss_url: null },
  { name: "Figma", domain: "figma.com", github_org: "figma", job_board_provider: "greenhouse", job_board_slug: "figma", blog_rss_url: null },
  { name: "Airbnb", domain: "airbnb.com", github_org: "airbnb", job_board_provider: "greenhouse", job_board_slug: "airbnb", blog_rss_url: null },
  { name: "Shopify", domain: "shopify.com", github_org: "Shopify", job_board_provider: null, job_board_slug: null, blog_rss_url: null },
  { name: "Vercel", domain: "vercel.com", github_org: "vercel", job_board_provider: "greenhouse", job_board_slug: "vercel", blog_rss_url: null },
];
