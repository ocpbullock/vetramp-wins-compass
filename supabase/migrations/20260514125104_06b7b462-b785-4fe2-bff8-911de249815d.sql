-- Lightweight starring of SAM.gov opportunities, scoped to a team.
CREATE TABLE public.starred_opportunities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  notice_id text NOT NULL,
  title text,
  naics_code text,
  response_deadline timestamptz,
  posted_date timestamptz,
  set_aside_description text,
  source_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT starred_opportunities_team_notice_unique UNIQUE (team_id, notice_id)
);

CREATE INDEX idx_starred_opportunities_team ON public.starred_opportunities(team_id);
CREATE INDEX idx_starred_opportunities_user ON public.starred_opportunities(user_id);

ALTER TABLE public.starred_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View team starred opportunities"
  ON public.starred_opportunities
  FOR SELECT
  TO authenticated
  USING (is_team_member(team_id, auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Insert team starred opportunities"
  ON public.starred_opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND is_team_member(team_id, auth.uid())
  );

CREATE POLICY "Delete team starred opportunities"
  ON public.starred_opportunities
  FOR DELETE
  TO authenticated
  USING (
    is_team_member(team_id, auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
  );
