-- pg_net does not support ALTER EXTENSION SET SCHEMA, so drop and recreate.
-- Unschedule the job first because it references net.http_post.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompete-watch-daily') THEN
    PERFORM cron.unschedule('recompete-watch-daily');
  END IF;
END $$;

DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Re-schedule the daily recompete watcher trigger against extensions.http_post.
SELECT cron.schedule(
  'recompete-watch-daily',
  '0 10 * * *',
  $cron$
  SELECT extensions.http_post(
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
