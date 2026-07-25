
CREATE TABLE public.diagnostics_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  ran_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total INT NOT NULL DEFAULT 0,
  passed INT NOT NULL DEFAULT 0,
  warned INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  results JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.diagnostics_runs TO authenticated;
GRANT ALL ON public.diagnostics_runs TO service_role;

ALTER TABLE public.diagnostics_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team members can view diagnostics runs"
  ON public.diagnostics_runs FOR SELECT
  TO authenticated
  USING (team_id IS NULL OR private.is_team_member(team_id, auth.uid()));

CREATE POLICY "Team members can insert diagnostics runs"
  ON public.diagnostics_runs FOR INSERT
  TO authenticated
  WITH CHECK (
    ran_by = auth.uid()
    AND (team_id IS NULL OR private.is_team_member(team_id, auth.uid()))
  );

CREATE INDEX idx_diagnostics_runs_team_ran_at ON public.diagnostics_runs (team_id, ran_at DESC);
