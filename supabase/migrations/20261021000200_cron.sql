-- Schedules the `sync` Edge Function. The key it checks lives in Vault as `dash_cron_key`
-- (inserted separately, never in this file): select vault.create_secret('<CRON_KEY>', 'dash_cron_key');
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.call_dash_sync(mode text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT net.http_post(
    url := 'https://itikdlckqicoobxnkldq.supabase.co/functions/v1/sync?mode=' || mode,
    headers := jsonb_build_object('x-cron-key', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'dash_cron_key')),
    timeout_milliseconds := 150000
  );
$$;
REVOKE ALL ON FUNCTION public.call_dash_sync(text) FROM PUBLIC, anon, authenticated;

-- Every 30 minutes: incremental sync + snapshot.
SELECT cron.schedule('dash-sync', '*/30 * * * *', $$SELECT public.call_dash_sync('incremental')$$);
-- 03:05–04:55 São Paulo (06–07 UTC), offset by 5 min: nightly reconcile in slices until done.
SELECT cron.schedule('dash-nightly', '5-55/10 6-7 * * *', $$SELECT public.call_dash_sync('nightly')$$);
