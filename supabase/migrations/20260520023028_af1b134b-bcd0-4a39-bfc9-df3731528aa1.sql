
CREATE TABLE public.pwin_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL,
  scenario_name text NOT NULL,
  team_composition jsonb NOT NULL DEFAULT '[]'::jsonb,
  pwin_score numeric NOT NULL DEFAULT 0,
  factor_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  engagement_type text NOT NULL DEFAULT 'prime',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pwin_scenarios_proposal ON public.pwin_scenarios(proposal_id);

ALTER TABLE public.pwin_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View pwin scenarios"
ON public.pwin_scenarios FOR SELECT
USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Insert pwin scenarios"
ON public.pwin_scenarios FOR INSERT
WITH CHECK (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Update pwin scenarios"
ON public.pwin_scenarios FOR UPDATE
USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE POLICY "Delete pwin scenarios"
ON public.pwin_scenarios FOR DELETE
USING (public.user_can_see_proposal(proposal_id, auth.uid()));

CREATE TRIGGER update_pwin_scenarios_updated_at
BEFORE UPDATE ON public.pwin_scenarios
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
