CREATE TABLE public.opportunity_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  team_id uuid,
  title text NOT NULL,
  detail text,
  owner_user_id uuid,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  created_from_analysis boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_opportunity_activities_proposal_id ON public.opportunity_activities(proposal_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.opportunity_activities TO authenticated;
GRANT ALL ON public.opportunity_activities TO service_role;

ALTER TABLE public.opportunity_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View opportunity activities" ON public.opportunity_activities
  FOR SELECT USING (public.user_can_see_proposal(proposal_id, auth.uid()));
CREATE POLICY "Insert opportunity activities" ON public.opportunity_activities
  FOR INSERT WITH CHECK (public.user_can_see_proposal(proposal_id, auth.uid()));
CREATE POLICY "Update opportunity activities" ON public.opportunity_activities
  FOR UPDATE USING (public.user_can_see_proposal(proposal_id, auth.uid()));
CREATE POLICY "Delete opportunity activities" ON public.opportunity_activities
  FOR DELETE USING (public.user_can_see_proposal(proposal_id, auth.uid()));

ALTER TABLE public.proposals
  ADD COLUMN outcome text CHECK (outcome IN ('won','lost','no_bid')),
  ADD COLUMN outcome_reasons text,
  ADD COLUMN lessons_learned text,
  ADD COLUMN outcome_recorded_at timestamptz;