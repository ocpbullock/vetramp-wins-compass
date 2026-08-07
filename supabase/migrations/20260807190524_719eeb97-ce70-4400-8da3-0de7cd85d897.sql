CREATE TABLE public.fedspend_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX fedspend_cache_team_key_idx ON public.fedspend_cache (team_id, cache_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fedspend_cache TO authenticated;
GRANT ALL ON public.fedspend_cache TO service_role;

ALTER TABLE public.fedspend_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members read fedspend cache"
  ON public.fedspend_cache FOR SELECT
  USING (private.is_team_member(team_id, auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Team members write fedspend cache"
  ON public.fedspend_cache FOR INSERT
  WITH CHECK (private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members update fedspend cache"
  ON public.fedspend_cache FOR UPDATE
  USING (private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members delete fedspend cache"
  ON public.fedspend_cache FOR DELETE
  USING (private.is_team_member(team_id, auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role));