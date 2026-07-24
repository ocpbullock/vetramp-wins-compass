-- Enable scheduling + outbound HTTP extensions.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Store a random shared secret in Supabase Vault so its value never appears in
-- migration SQL. The wrapper route reads the same value and compares.
DO $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'recompete_watch_cron_secret';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'recompete_watch_cron_secret',
      'Shared secret used by pg_cron to authenticate the recompete-watch daily batch trigger.'
    );
  END IF;
END $$;

-- Unschedule any prior version of this job so re-running the migration is safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompete-watch-daily') THEN
    PERFORM cron.unschedule('recompete-watch-daily');
  END IF;
END $$;

-- Schedule: every day at 10:00 UTC. Reads the shared secret from Vault at run
-- time and posts it as the x-cron-secret header to the app's wrapper endpoint.
SELECT cron.schedule(
  'recompete-watch-daily',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://project--bafe3a4b-f889-4ccf-8587-5e092cb4ed6c.lovable.app/api/public/hooks/recompete-watch-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'recompete_watch_cron_secret'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $cron$
);
