-- Runs the Google Sheets sync every 5 minutes from Supabase (free), by calling the app's /api/sync/sheets.
-- Vercel Cron can't do this on the free Hobby plan: it allows at most one run per day.
--
-- Run once in the Supabase SQL editor AFTER the app is deployed. Replace the two values marked <<...>>:
--   <<APP URL>>      e.g. https://counter.greencartires.ca  or  https://gct-counter.vercel.app
--   <<CRON_SECRET>>  the same value as CRON_SECRET in Vercel's environment variables
-- Re-running it is safe: it replaces the schedule and the stored secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Keep the secret in Supabase Vault, not in the job text.
select vault.create_secret('<<CRON_SECRET>>', 'gct_cron_secret')
where not exists (select 1 from vault.secrets where name = 'gct_cron_secret');
select vault.update_secret(id, '<<CRON_SECRET>>') from vault.secrets where name = 'gct_cron_secret';

select cron.schedule('gct-sync-sheets', '*/5 * * * *', $job$
  select net.http_post(
    url     := '<<APP URL>>/api/sync/sheets',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gct_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000);
$job$);

-- Check it's working (wait 5 minutes):
--   select status_code, left(content::text, 300), created from net._http_response order by created desc limit 5;
--   select * from inventory_syncs order by id desc limit 5;
-- Pause it:  select cron.unschedule('gct-sync-sheets');
