CREATE TABLE public.cached_competitive_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text UNIQUE NOT NULL,
  agency text,
  naics_code text,
  set_aside text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_cci_expires ON public.cached_competitive_intel (expires_at);

ALTER TABLE public.cached_competitive_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read cci" ON public.cached_competitive_intel FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert cci" ON public.cached_competitive_intel FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Auth update cci" ON public.cached_competitive_intel FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Auth delete cci" ON public.cached_competitive_intel FOR DELETE TO authenticated USING (true);