-- Tech Stack Scout — Supabase scheduled job (pg_cron + pg_net)
--
-- Run this ONCE in the Supabase SQL editor after the app is deployed on Vercel.
-- Replace the two placeholders first. Values are stored in Supabase Vault, not in the job text.
--
-- What it does: every 10 minutes, Supabase calls GET /api/cron/refresh on the Vercel app.
-- That endpoint (1) queues every active company whose weekly refresh is due and
-- (2) drains the research queue (4 companies at a time, with retries/backoff).
-- Idle runs cost one quick HTTP request. Vercel Cron (vercel.json, Mondays 02:00 UTC)
-- calls the same endpoint as a second, independent trigger.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-APP.vercel.app', 'tss_app_url', 'Tech Stack Scout base URL');
select vault.create_secret('YOUR_CRON_SECRET', 'tss_cron_secret', 'Tech Stack Scout CRON_SECRET');

select cron.schedule(
  'tech-stack-scout-refresh',
  '*/10 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tss_app_url') || '/api/cron/refresh?source=pg_cron',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tss_cron_secret')
    ),
    timeout_milliseconds := 10000
  );
  $$
);

-- Verify:
--   select jobname, schedule, active from cron.job;
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, content, created from net._http_response order by created desc limit 5;
-- Remove:
--   select cron.unschedule('tech-stack-scout-refresh');
