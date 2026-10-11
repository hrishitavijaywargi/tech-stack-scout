-- Seed watchlist (every GitHub org and job board verified with `npx tsx scripts/verify-seed.ts`).
-- Idempotent: re-running updates the sources of existing rows (matched on domain).
insert into public.companies (name, domain, github_org, job_board_provider, job_board_slug, blog_rss_url) values
  ('Stripe',     'stripe.com',     'stripe',     'greenhouse', 'stripe',     null),
  ('Cloudflare', 'cloudflare.com', 'cloudflare', 'greenhouse', 'cloudflare', 'https://blog.cloudflare.com/rss/'),
  ('Datadog',    'datadoghq.com',  'DataDog',    'greenhouse', 'datadog',    null),
  ('Discord',    'discord.com',    'discord',    'greenhouse', 'discord',    null),
  ('Figma',      'figma.com',      'figma',      'greenhouse', 'figma',      null),
  ('Airbnb',     'airbnb.com',     'airbnb',     'greenhouse', 'airbnb',     null),
  ('Shopify',    'shopify.com',    'Shopify',    null,         null,         null),
  ('Vercel',     'vercel.com',     'vercel',     'greenhouse', 'vercel',     null)
on conflict (domain) do update set
  github_org = excluded.github_org,
  job_board_provider = excluded.job_board_provider,
  job_board_slug = excluded.job_board_slug,
  blog_rss_url = coalesce(excluded.blog_rss_url, public.companies.blog_rss_url),
  is_active = true;
